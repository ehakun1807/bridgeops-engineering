// ---------------------------------------------------------------------------
// Vercel serverless function: POST /api/org-insights
//
// Accepts the user's full set of persisted AI Analysis results (from the
// projectIntelligence collection, read client-side) and asks Gemini to
// surface cross-project patterns, recurring risks, and org-level recommendations.
//
// This is the Layer 3 entry point of the NPI Intelligence org-learning arc.
// The client reads projectIntelligence/{projectId} docs for all user projects
// and sends them here in the request body — no firebase-admin dependency needed.
//
// Security: same Firebase ID-token + allowlist gate as all other handlers.
// Runtime: Vercel Node (Node 20+, global fetch available).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

const FIREBASE_PROJECT_ID = 'gen-lang-client-0703668573';

// Closed-beta allowlist — KEEP IN SYNC with config.ts (ALLOWED_EMAILS),
// firestore.rules (isAdmin's email-in list), and all other api/* handlers.
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
  if (cachedCerts && Date.now() - cachedCerts.fetchedAt < CERT_TTL_MS) {
    return cachedCerts.certs;
  }
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
  const header  = JSON.parse(Buffer.from(headerB64,  'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as FirebasePayload;
  if (header.alg !== 'RS256') throw new Error('unexpected alg');
  if (!header.kid) throw new Error('missing kid');
  const certs = await getGoogleCerts();
  const cert  = certs[header.kid];
  if (!cert) throw new Error('unknown kid');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  if (!verifier.verify(cert, Buffer.from(signatureB64, 'base64url'))) throw new Error('bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('expired');
  if (payload.iat > now + 60) throw new Error('issued in future');
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) throw new Error('bad iss');
  if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error('bad aud');
  return payload;
}

// ---------------------------------------------------------------------------
// Input types — mirrored from aiClient.ts / projectIntelligence doc shape.
// Inlined (no cross-file import) per Vercel bundler .ts gotcha.
// ---------------------------------------------------------------------------

interface AIRisk {
  flag: string;
  source: string;
  severity: 'high' | 'medium' | 'low';
}

interface AIAction {
  title: string;
  rationale: string;
  impact: 'high' | 'medium' | 'low';
}

interface ProjectSnapshot {
  projectId: string;
  projectName: string;
  analyzedAtMs: number;
  currentGate?: string;
  overallScore?: number;
  statusSnapshot?: string;
  risks?: AIRisk[];
  topActions?: AIAction[];
}

// ---------------------------------------------------------------------------
// Gemini response schema
// ---------------------------------------------------------------------------

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    patterns: {
      type: 'array',
      description: 'Cross-project patterns — behaviours or outcomes that appear in 2+ projects.',
      items: {
        type: 'object',
        properties: {
          title:            { type: 'string', description: 'Short pattern name, max 10 words' },
          description:      { type: 'string', description: '2-3 sentences describing the pattern and its implication for future projects. Max 80 words.' },
          affectedProjects: { type: 'array', items: { type: 'string' }, description: 'Project names where this pattern appears' },
          category:         { type: 'string', enum: ['supplier', 'process', 'quality', 'schedule', 'design', 'commercial'] },
          severity:         { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['title', 'description', 'affectedProjects', 'category', 'severity']
      }
    },
    recurringRisks: {
      type: 'array',
      description: 'Risk types that appear in multiple projects — the org\'s systemic blind spots.',
      items: {
        type: 'object',
        properties: {
          description:      { type: 'string', description: 'Risk description, max 20 words' },
          occurrences:      { type: 'number', description: 'Number of projects where this risk appears' },
          affectedProjects: { type: 'array', items: { type: 'string' } }
        },
        required: ['description', 'occurrences', 'affectedProjects']
      }
    },
    recommendations: {
      type: 'array',
      description: 'Org-level process or structural recommendations based on cross-project evidence. Max 5.',
      items: {
        type: 'object',
        properties: {
          action:    { type: 'string', description: 'Recommended action, max 15 words' },
          rationale: { type: 'string', description: '2-3 sentences citing specific cross-project evidence. Max 80 words.' },
          priority:  { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['action', 'rationale', 'priority']
      }
    },
    summary: {
      type: 'string',
      description: 'One paragraph (max 60 words) — the single most important takeaway from this org-level scan.'
    }
  },
  required: ['patterns', 'recurringRisks', 'recommendations', 'summary']
};

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(projects: ProjectSnapshot[]): string {
  const lines: string[] = [];
  lines.push('You are an NPI operational intelligence system analyzing cross-project patterns for a hardware engineering organization.');
  lines.push(`You have access to AI Analysis results from ${projects.length} project(s). Your job is to find patterns, recurring risks, and systemic gaps that span multiple projects — things no single-project analysis can surface.`);
  lines.push('');
  lines.push('## Project Snapshots');

  for (const p of projects) {
    const date = new Date(p.analyzedAtMs).toISOString().slice(0, 10);
    lines.push('');
    lines.push(`### ${p.projectName}`);
    lines.push(`Analyzed: ${date}${p.currentGate ? ` | Current gate: ${p.currentGate}` : ''}${p.overallScore != null ? ` | Overall RAMP score: ${p.overallScore}%` : ''}`);
    if (p.statusSnapshot) lines.push(`Status: ${p.statusSnapshot}`);

    if (p.risks && p.risks.length > 0) {
      lines.push('Risks:');
      for (const r of p.risks) {
        lines.push(`  - [${r.severity.toUpperCase()}] ${r.flag} (source: ${r.source})`);
      }
    }

    if (p.topActions && p.topActions.length > 0) {
      lines.push('Top actions:');
      for (const a of p.topActions.slice(0, 3)) {
        lines.push(`  - [${a.impact.toUpperCase()}] ${a.title}`);
      }
    }
  }

  lines.push('');
  lines.push('## Your Task');
  lines.push('Analyze the above snapshots and return:');
  lines.push('1. patterns — behaviours or outcomes appearing in 2+ projects (e.g. "supplier swaps consistently happen after CDR", "PFMEA high-RPN risks cluster in manufacturing process steps"). Only include patterns with clear cross-project evidence.');
  lines.push('2. recurringRisks — specific risk types that surface repeatedly across projects. These are the org\'s systemic blind spots — the risks that keep showing up regardless of project team or product type.');
  lines.push('3. recommendations — org-level process or structural changes that would prevent the identified patterns from repeating. Ground each recommendation in the cross-project evidence above.');
  lines.push('4. summary — the single most important takeaway in one paragraph.');
  lines.push('');
  lines.push('Be specific. Reference project names. Avoid generic advice. If fewer than 2 projects are available, note that patterns require more data but still surface any early signals.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const auth = req.headers.authorization;
  const authHeader = Array.isArray(auth) ? auth[0] : auth;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'missing auth' });
  const token = authHeader.slice('Bearer '.length);

  let payload: FirebasePayload;
  try {
    payload = await verifyFirebaseToken(token);
  } catch (err: any) {
    console.warn('JWT verify failed:', err?.message);
    return res.status(401).json({ error: 'invalid token' });
  }

  if (!isAllowedEmail(payload.email)) return res.status(403).json({ error: 'forbidden' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'server not configured' });

  const projects = req.body?.projects as ProjectSnapshot[] | undefined;
  if (!Array.isArray(projects) || projects.length === 0) {
    return res.status(400).json({ error: 'no project data — run AI Analysis on at least one project first' });
  }

  // Cap at 20 projects to keep prompt within token budget.
  const capped = projects.slice(0, 20);
  const prompt = buildPrompt(capped);

  // Retry + fallback ladder — same pattern as all other AI handlers.
  const PRIMARY_MODEL  = 'gemini-2.5-flash';
  const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
  const RETRY_STATUSES = new Set([429, 500, 502, 503]);

  type CallResult =
    | { kind: 'ok'; res: Response; model: string }
    | { kind: 'http_error'; statusCode: number; text: string; model: string }
    | { kind: 'network_error'; error: any; model: string };

  async function callModel(model: string, backoffMs: number[]): Promise<CallResult> {
    const maxAttempts = 1 + backoffMs.length;
    let lastHttp: { statusCode: number; text: string } | null = null;
    let lastNetwork: any = null;
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.5,
        maxOutputTokens: 4096
      }
    };
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );
        if (r.ok) return { kind: 'ok', res: r, model };
        const txt = await r.text().catch(() => '');
        lastHttp = { statusCode: r.status, text: txt };
        if (!RETRY_STATUSES.has(r.status) || attempt === maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt - 1]));
      } catch (err: any) {
        lastNetwork = err;
        if (attempt === maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt - 1]));
      }
    }
    if (lastHttp) return { kind: 'http_error', ...lastHttp, model };
    return { kind: 'network_error', error: lastNetwork, model };
  }

  // Primary with 2 retries, then one fallback attempt.
  let result = await callModel(PRIMARY_MODEL, [500, 1500]);
  if (result.kind !== 'ok') {
    const isTransient =
      result.kind === 'network_error' ||
      (result.kind === 'http_error' && RETRY_STATUSES.has(result.statusCode));
    if (isTransient) {
      console.warn(`org-insights: primary exhausted, falling back to ${FALLBACK_MODEL}`);
      result = await callModel(FALLBACK_MODEL, []);
    }
  }

  if (result.kind !== 'ok') {
    const statusCode = result.kind === 'http_error' ? result.statusCode : 502;
    const rawText    = result.kind === 'http_error' ? result.text : String(result.error?.message ?? '');
    // Strip API key from any leaked error text.
    const safeDetail = rawText.replace(/AIza[A-Za-z0-9_-]{35}/g, 'AIza…').slice(0, 300);
    if (statusCode === 503 || statusCode === 429) {
      return res.status(503).json({ error: 'AI service is overloaded right now — please try again in a minute.' });
    }
    return res.status(502).json({ error: 'AI service error', detail: safeDetail });
  }

  let data: any;
  try {
    data = await result.res.json();
  } catch {
    return res.status(502).json({ error: 'invalid JSON from AI service' });
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return res.status(502).json({ error: 'empty AI response' });

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return res.status(502).json({ error: 'AI returned non-JSON content' });
  }

  return res.status(200).json({
    insights: parsed,
    projectCount: capped.length,
    generatedAtMs: Date.now(),
    model: result.model
  });
}
