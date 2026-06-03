// ---------------------------------------------------------------------------
// Vercel serverless function: POST /api/guidelines-upload-token
//
// Issues a short-lived Vercel Blob client upload token so the browser can
// upload company guideline PDFs directly to Blob (bypasses 4.5MB body limit).
// After upload, the client calls /api/guidelines-extract with the Blob URL.
//
// Mirrors docguard-upload-token.ts pattern exactly.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

const FIREBASE_PROJECT_ID = 'gen-lang-client-0703668573';

// Closed-beta allowlist — KEEP IN SYNC with config.ts + firestore.rules.
const ALLOWED_EMAILS = new Set([
  'ehakun1807@gmail.com',
  'beta1@bridgeops.local',
  'beta2@bridgeops.local',
].map((e) => e.toLowerCase()));
function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ALLOWED_EMAILS.has(email.toLowerCase());
}
const MAX_PDF_BYTES = 15 * 1024 * 1024;

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
  const cert = certs[header.kid];
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

interface ReqLike { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; body: any; }
interface ResLike { status(code: number): ResLike; json(data: any): ResLike; }

export default async function handler(req: ReqLike, res: ResLike) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const body = req.body as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request: req as unknown as Request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        if (!clientPayload || typeof clientPayload !== 'string') throw new Error('missing auth payload');
        let payload: FirebasePayload;
        try { payload = await verifyFirebaseToken(clientPayload); }
        catch (err: any) { console.warn('JWT verify failed:', err?.message); throw new Error('invalid token'); }
        if (!isAllowedEmail(payload.email)) throw new Error('forbidden');
        return {
          allowedContentTypes: ['application/pdf'],
          maximumSizeInBytes: MAX_PDF_BYTES,
          validUntil: Date.now() + 60 * 1000,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ uid: payload.user_id })
        };
      },
      onUploadCompleted: async () => { /* blob deleted after extraction */ }
    });
    return res.status(200).json(jsonResponse);
  } catch (err: any) {
    console.error('handleUpload failed:', err?.message);
    return res.status(400).json({ error: err?.message || 'upload-token failed' });
  }
}
