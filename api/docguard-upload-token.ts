// ---------------------------------------------------------------------------
// Vercel serverless function: POST /api/docguard-upload-token
//
// Issues a short-lived client upload token for Vercel Blob, so the browser
// can upload PDFs directly to Blob storage (bypassing Vercel's 4.5MB
// function body limit).
//
// Flow: client calls @vercel/blob/client `upload()`, which POSTs here to
// get a token, then the client uploads the file directly to Blob.
//
// Security: same Firebase ID-token + admin-email gate as /api/ai-analyze.
// Token enforces: application/pdf only, 15MB max.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

const FIREBASE_PROJECT_ID = 'gen-lang-client-0703668573';

// Closed-beta allowlist — KEEP IN SYNC with config.ts + firestore.rules.
// See note in /api/ai-analyze.ts for why this is inlined rather than imported.
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

let cachedCerts: { fetchedAt: number; certs: Record<string, string> } | null =
  null;
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
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  sub: string;
  user_id: string;
  email?: string;
  email_verified?: boolean;
}

async function verifyFirebaseToken(idToken: string): Promise<FirebasePayload> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('malformed jwt');

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(
    Buffer.from(headerB64, 'base64url').toString('utf8')
  );
  const payload = JSON.parse(
    Buffer.from(payloadB64, 'base64url').toString('utf8')
  ) as FirebasePayload;

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
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`)
    throw new Error('bad iss');
  if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error('bad aud');

  return payload;
}

interface ReqLike {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}
interface ResLike {
  status(code: number): ResLike;
  json(data: any): ResLike;
}

export default async function handler(req: ReqLike, res: ResLike) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  // The @vercel/blob/client lifecycle has two phases that hit this route:
  //
  //   1. blob.generate-client-token — browser asks for an upload token.
  //      Auth is enforced inside onBeforeGenerateToken below, where we
  //      receive the Firebase ID token via clientPayload (the @vercel/blob
  //      client doesn't forward custom Authorization headers from the
  //      browser, so clientPayload is the only secure channel).
  //   2. blob.upload-completed — Vercel Blob webhook (production only),
  //      validated server-side by handleUpload via BLOB_READ_WRITE_TOKEN.
  const body = req.body as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      // The library reads request.headers + request.url; the Express-style
      // req object satisfies that surface in practice.
      request: req as unknown as Request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // clientPayload is the Firebase ID token sent by the browser
        // (auditPdf in docGuardClient.ts).
        if (!clientPayload || typeof clientPayload !== 'string') {
          throw new Error('missing auth payload');
        }

        let payload: FirebasePayload;
        try {
          payload = await verifyFirebaseToken(clientPayload);
        } catch (err: any) {
          console.warn('JWT verify failed:', err?.message);
          throw new Error('invalid token');
        }

        // Closed-beta gate: allowlist only. See note in /api/ai-analyze.ts.
        if (!isAllowedEmail(payload.email)) {
          throw new Error('forbidden');
        }

        return {
          allowedContentTypes: ['application/pdf'],
          maximumSizeInBytes: MAX_PDF_BYTES,
          // Short-lived — we expect the upload to complete within a minute.
          validUntil: Date.now() + 60 * 1000,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ uid: payload.user_id, pathname })
        };
      },
      onUploadCompleted: async () => {
        // No-op. /api/docguard deletes the blob after audit completes.
        // (This webhook only fires in production anyway.)
      }
    });
    return res.status(200).json(jsonResponse);
  } catch (err: any) {
    console.error('handleUpload failed:', err?.message);
    return res.status(400).json({ error: err?.message || 'upload-token failed' });
  }
}
