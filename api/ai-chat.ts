// ---------------------------------------------------------------------------
// Vercel serverless function: POST /api/ai-chat
//
// Conversational AI advisor grounded in the caller's project context
// (PFMEA signals, RAMP score, gate status, decisions, BOM flags) plus
// live Google Search so recommendations are validated against current
// industry practice — not just training-cutoff knowledge.
//
// Auth + retry pattern mirrors /api/ai-coach.ts.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

const FIREBASE_PROJECT_ID = 'gen-lang-client-0703668573';

const ALLOWED_EMAILS = new Set([
  'ehakun1807@gmail.com',
  'beta1@bridgeops.local',
  'beta2@bridgeops.local',
].map((e) => e.toLowerCase()));

function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ALLOWED_EMAILS.has(email.toLowerCase());
}

const PUBLIC_KEYS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedCerts: { fetchedAt: number; certs: Record<string, string> } | null = null;
const CERT_TTL_MS = 60 * 60 * 1000;

async function getGoogleCerts(): Promise<Record<string, string>> {
  if (cachedCerts && Date.now() - cachedCerts.fetchedAt < CERT_TTL_MS) return cachedCerts.certs;
  const res = await fetch(PUBLIC_KEYS_URL);
  if (!res.ok) throw new Error(`cert fetch ${res.status}`);
  const certs = (await res.json()) as Record<string, string>;
  cachedCerts = { fetchedAt: Date.now(), certs };
  return certs;
}

interface FirebasePayload {
  iss: string; aud: string; exp: number; iat: number;
  sub: string; user_id: string; email?: string; email_verified?: boolean;
}

async function verifyFirebaseToken(idToken: string): Promise<FirebasePayload> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('malformed jwt');
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as FirebasePayload;
  if (header.alg !== 'RS256') throw new Error('unexpected alg');
  if (!header.kid) throw new Error('missing kid');
  const certs = await getGoogleCerts();
  const cert = certs[header.kid];
  if (!cert) throw new Error('unknown kid');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const ok = verifier.verify(cert, Buffer.from(signatureB64, 'base64url'));
  if (!ok) throw new Error('bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('expired');
  if (payload.iat > now + 60) throw new Error('issued in future');
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) throw new Error('bad iss');
  if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error('bad aud');
  return payload;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ProjectContext {
  projectName: string;
  productType?: string;
  currentGate?: string;
  rampScore?: number;
  standards?: string[];
  // Optional enriched signals (populated by client from Firestore)
  pfmeaHighRisks?: Array<{ description: string; rpn: number }>;
  openDecisions?: string[];
  bomFlags?: string[];
  supplyChainScore?: number;
  qualityScore?: number;
  manufacturingScore?: number;
}

interface ChatRequest {
  message: string;
  history?: ChatMessage[];      // last N turns for context
  projectContext: ProjectContext;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(ctx: ProjectContext): string {
  const lines: string[] = [];

  lines.push(
    'You are Bridget — BridgeOps' program advisor. You have 20+ years of NPI (New Product Introduction) hardware transfer experience across Medical, Aerospace, Automotive, Industrial IoT, and Consumer Electronics. You are trusted, direct, and always grounded in the user's actual program data.'
  );
  lines.push('');
  lines.push('You are advising a program manager or engineer inside BridgeOps. Speak like a trusted senior colleague — not a chatbot.');
  lines.push('You have full context of their live project data (below). Use it to give specific, grounded advice — not generic guidance.');
  lines.push('Google Search is enabled. Use it to validate recommendations against current industry practice, active standards, and recent supplier/technology developments.');
  lines.push('');
  lines.push('── PROJECT CONTEXT ──');
  lines.push(`Project: ${ctx.projectName}`);
  if (ctx.productType) lines.push(`Product type: ${ctx.productType}`);
  if (ctx.currentGate) lines.push(`Current gate: ${ctx.currentGate}`);
  if (ctx.rampScore !== undefined) lines.push(`RAMP readiness score: ${ctx.rampScore.toFixed(0)}%`);
  if (ctx.manufacturingScore !== undefined) lines.push(`Manufacturing RAMP: ${ctx.manufacturingScore.toFixed(0)}%`);
  if (ctx.qualityScore !== undefined) lines.push(`Quality RAMP: ${ctx.qualityScore.toFixed(0)}%`);
  if (ctx.supplyChainScore !== undefined) lines.push(`Supply Chain RAMP: ${ctx.supplyChainScore.toFixed(0)}%`);

  if (ctx.standards && ctx.standards.length > 0) {
    lines.push(`Applicable standards: ${ctx.standards.join(', ')}`);
  }

  if (ctx.pfmeaHighRisks && ctx.pfmeaHighRisks.length > 0) {
    lines.push('');
    lines.push('High-RPN PFMEA risks:');
    ctx.pfmeaHighRisks.forEach(r => lines.push(`  - ${r.description} (RPN ${r.rpn})`));
  }

  if (ctx.openDecisions && ctx.openDecisions.length > 0) {
    lines.push('');
    lines.push('Open engineering decisions:');
    ctx.openDecisions.forEach(d => lines.push(`  - ${d}`));
  }

  if (ctx.bomFlags && ctx.bomFlags.length > 0) {
    lines.push('');
    lines.push('BOM flags / recent changes:');
    ctx.bomFlags.forEach(b => lines.push(`  - ${b}`));
  }

  lines.push('');
  lines.push('── HOW TO RESPOND ──');
  lines.push('- Be direct and specific. Reference the actual project data when relevant.');
  lines.push('- Lead with the answer, then the reasoning. Keep it concise.');
  lines.push('- When you use external search to validate a recommendation, note it briefly ("validated against current industry practice" or similar) — but do not list sources verbatim.');
  lines.push('- If you cannot answer without more information, ask one focused question.');
  lines.push('- Do not use markdown headers. Use plain paragraph breaks. Bold key terms sparingly.');
  lines.push('- Max 3 short paragraphs unless the question genuinely requires more depth.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const PRIMARY_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
const RETRY_STATUSES = new Set([429, 500, 502, 503]);

interface ReqLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}
interface ResLike {
  status(code: number): ResLike;
  json(data: any): ResLike;
}

export default async function handler(req: ReqLike, res: ResLike) {
  try {
    return await _handler(req, res);
  } catch (err: any) {
    console.error('[ai-chat] unhandled error:', err?.message, err?.stack);
    return res.status(500).json({ error: 'internal error: ' + (err?.message || 'unknown') });
  }
}

async function _handler(req: ReqLike, res: ResLike) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const auth = req.headers.authorization;
  const authHeader = Array.isArray(auth) ? auth[0] : auth;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'missing auth' });
  const token = authHeader.slice('Bearer '.length);

  let payload: FirebasePayload;
  try { payload = await verifyFirebaseToken(token); }
  catch (err: any) { console.warn('JWT verify failed:', err?.message); return res.status(401).json({ error: 'invalid token' }); }

  if (!isAllowedEmail(payload.email)) return res.status(403).json({ error: 'forbidden' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'server not configured' });

  const body = req.body as Partial<ChatRequest>;
  if (!body?.message || !body?.projectContext?.projectName) {
    return res.status(400).json({ error: 'missing message or projectContext' });
  }

  const systemPrompt = buildSystemPrompt(body.projectContext);
  const history = (body.history || []).slice(-8); // last 8 turns max

  // Build Gemini contents array
  const contents: any[] = [];

  // Inject history
  for (const turn of history) {
    contents.push({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }]
    });
  }

  // Current user message
  contents.push({ role: 'user', parts: [{ text: body.message }] });

  const geminiBody = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 1024
    }
  };

  type CallResult =
    | { kind: 'ok'; res: Response; model: string }
    | { kind: 'http_error'; statusCode: number; text: string; model: string }
    | { kind: 'network_error'; error: any; model: string };

  async function callModel(model: string, backoffMs: number[]): Promise<CallResult> {
    const maxAttempts = 1 + backoffMs.length;
    let lastHttp: { statusCode: number; text: string } | null = null;
    let lastNetwork: any = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) }
        );
        if (r.ok) return { kind: 'ok', res: r, model };
        const txt = await r.text().catch(() => '');
        lastHttp = { statusCode: r.status, text: txt };
        if (!RETRY_STATUSES.has(r.status) || attempt === maxAttempts) break;
        await new Promise(resolve => setTimeout(resolve, backoffMs[attempt - 1]));
      } catch (err: any) {
        lastNetwork = err;
        if (attempt === maxAttempts) break;
        await new Promise(resolve => setTimeout(resolve, backoffMs[attempt - 1]));
      }
    }
    if (lastHttp) return { kind: 'http_error', model, statusCode: lastHttp.statusCode, text: lastHttp.text };
    return { kind: 'network_error', model, error: lastNetwork };
  }

  let result: CallResult = await callModel(PRIMARY_MODEL, [500, 1500]);

  if (result.kind !== 'ok') {
    const transient =
      result.kind === 'network_error' ||
      (result.kind === 'http_error' && (RETRY_STATUSES.has(result.statusCode) || result.statusCode === 400));
    if (transient) {
      // Fallback without grounding (lite model)
      const fallbackBody = { ...geminiBody, tools: undefined };
      const fb = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${FALLBACK_MODEL}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fallbackBody) }
      );
      if (fb.ok) result = { kind: 'ok', res: fb, model: FALLBACK_MODEL };
    }
  }

  if (result.kind === 'network_error') return res.status(502).json({ error: 'ai service unreachable' });
  if (result.kind === 'http_error') return res.status(502).json({ error: `ai service error (${result.statusCode})` });

  const data: any = await result.res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return res.status(502).json({ error: 'empty ai response' });

  const grounded = result.model === PRIMARY_MODEL;
  return res.status(200).json({
    reply: text.trim(),
    modelVersion: grounded ? `${result.model}+search` : result.model,
    grounded
  });
}
