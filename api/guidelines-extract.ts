// ---------------------------------------------------------------------------
// Vercel serverless function: POST /api/guidelines-extract
//
// Receives a Vercel Blob URL pointing to a company guideline PDF, fetches it,
// sends it to Gemini with a structured extraction prompt, and returns a list
// of actionable requirements. The Blob is deleted after extraction.
//
// The extracted requirements are stored in Firestore (orgGuidelines collection)
// by the client — this handler only does the PDF→requirements conversion.
//
// Security: same Firebase ID-token + closed-beta allowlist as all other handlers.
// Retry + fallback: gemini-2.5-flash → gemini-2.5-flash-lite on 429/5xx.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { del } from '@vercel/blob';

const FIREBASE_PROJECT_ID = 'gen-lang-client-0703668573';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';

// Closed-beta allowlist — KEEP IN SYNC (10 places total).
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
  const [h64, p64, s64] = parts;
  const header  = JSON.parse(Buffer.from(h64, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8')) as FirebasePayload;
  if (header.alg !== 'RS256') throw new Error('unexpected alg');
  const certs = await getGoogleCerts();
  const cert = certs[header.kid];
  if (!cert) throw new Error('unknown kid');
  const v = crypto.createVerify('RSA-SHA256');
  v.update(`${h64}.${p64}`); v.end();
  if (!v.verify(cert, Buffer.from(s64, 'base64url'))) throw new Error('bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('expired');
  if (payload.iat > now + 60) throw new Error('issued in future');
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) throw new Error('bad iss');
  if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error('bad aud');
  return payload;
}

// ---------------------------------------------------------------------------
// Gemini call with retry + fallback
// ---------------------------------------------------------------------------

const RETRY_STATUSES = new Set([429, 500, 502, 503]);
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

type CallResult =
  | { ok: true; data: any }
  | { ok: false; status: number; body: string };

async function callGemini(
  model: string,
  requestBody: object,
  backoffMs = 0
): Promise<CallResult> {
  if (backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs));
  try {
    const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    return { ok: false, status: 0, body: err?.message ?? 'network error' };
  }
}

async function callWithRetry(requestBody: object): Promise<CallResult> {
  // Primary: gemini-2.5-flash with 2 retries
  for (const backoff of [0, 500, 1500]) {
    const r = await callGemini('gemini-2.5-flash', requestBody, backoff);
    if (r.ok) return r;
    const rFail = r as { ok: false; status: number; body: string };
    if (!RETRY_STATUSES.has(rFail.status)) return rFail;
  }
  // Fallback: gemini-2.5-flash-lite
  return callGemini('gemini-2.5-flash-lite', requestBody, 0);
}

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

function buildExtractionPrompt(fileName: string): string {
  return `You are an NPI readiness advisor reviewing a company procedure document.

Document: "${fileName}"

Extract every actionable requirement, obligation, or compliance checkpoint from this document that a hardware NPI project team must satisfy. Focus on requirements that could create risk or non-conformance if missed during a product development or manufacturing transfer project.

For each requirement:
- Write a concise, standalone sentence (≤120 chars) describing WHAT must be done or verified.
- Assign a category from: design_control | process_control | quality | supplier | documentation | regulatory | safety | validation | other
- Assign severity: critical (regulatory/safety impact if missed) | major (audit finding likely) | standard (normal process expectation)

Return ONLY valid JSON matching this schema:
{
  "requirements": [
    {
      "id": "req_1",
      "text": "string (≤120 chars)",
      "category": "design_control|process_control|quality|supplier|documentation|regulatory|safety|validation|other",
      "severity": "critical|major|standard"
    }
  ],
  "summary": "string (≤200 chars) — one-line description of what this document covers and its primary scope"
}

Extract up to 40 requirements. Prefer specificity over completeness — a sharp, actionable requirement is more useful than a vague one. Do NOT include aspirational statements, definitions, or scope descriptions as requirements.`;
}

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

interface ReqLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}
interface ResLike { status(code: number): ResLike; json(data: any): ResLike; }

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: ReqLike, res: ResLike) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  // Auth
  const authHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization ?? '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return res.status(401).json({ error: 'missing token' });

  let uid: string;
  let email: string | undefined;
  try {
    const payload = await verifyFirebaseToken(idToken);
    uid   = payload.user_id;
    email = payload.email;
  } catch (err: any) {
    return res.status(401).json({ error: 'invalid token', detail: err?.message });
  }
  if (!isAllowedEmail(email)) return res.status(403).json({ error: 'forbidden' });

  const { blobUrl, fileName } = req.body ?? {};
  if (!blobUrl || typeof blobUrl !== 'string') return res.status(400).json({ error: 'missing blobUrl' });
  if (!fileName || typeof fileName !== 'string') return res.status(400).json({ error: 'missing fileName' });

  let pdfBytes: ArrayBuffer;
  try {
    const pdfRes = await fetch(blobUrl);
    if (!pdfRes.ok) throw new Error(`blob fetch ${pdfRes.status}`);
    pdfBytes = await pdfRes.arrayBuffer();
  } catch (err: any) {
    return res.status(502).json({ error: 'failed to fetch PDF from blob', detail: err?.message });
  }

  // Always delete blob after fetching — whether extraction succeeds or not
  try {
    const base64 = Buffer.from(pdfBytes).toString('base64');
    const requestBody = {
      contents: [{
        parts: [
          { text: buildExtractionPrompt(fileName.slice(0, 100)) },
          { inlineData: { mimeType: 'application/pdf', data: base64 } }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 4096
      }
    };

    const result = await callWithRetry(requestBody);

    if (result.ok === false) {
      // Scrub API key from error body before returning
      const safeDetail = result.body
        .replace(/AIza[A-Za-z0-9_-]{35}/g, 'AIza***')
        .slice(0, 300);
      if (result.status === 503 || result.status === 429) {
        return res.status(503).json({
          error: 'AI service is overloaded right now — please try again in a minute.',
          detail: safeDetail
        });
      }
      return res.status(502).json({ error: 'ai service error', detail: safeDetail });
    }

    const raw = result.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    let parsed: { requirements: any[]; summary: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: 'ai returned invalid JSON', detail: raw.slice(0, 300) });
    }

    const requirements = (parsed.requirements ?? [])
      .slice(0, 40)
      .map((r: any, i: number) => ({
        id: r.id ?? `req_${i + 1}`,
        text: String(r.text ?? '').slice(0, 120),
        category: r.category ?? 'other',
        severity: r.severity ?? 'standard'
      }))
      .filter((r: any) => r.text.trim().length > 0);

    return res.status(200).json({
      requirements,
      summary: String(parsed.summary ?? '').slice(0, 200),
      uid
    });
  } finally {
    // Best-effort blob deletion — non-fatal if it fails
    try { await del(blobUrl); } catch (e) { console.warn('blob del failed:', e); }
  }
}
