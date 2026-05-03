// ---------------------------------------------------------------------------
// Vercel serverless function: POST /api/docguard
//
// Audits a manufacturing document (PDF) for: grammar/typos, step numbering,
// GMP format/structure, logical assembly order, and image clarity.
// Returns a structured list of short findings the front-end overlays as
// sticky-note annotations on the original PDF (via pdf-lib).
//
// Security: same Firebase ID-token + admin-email gate as /api/ai-analyze.
// Runtime: Vercel Node (default).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

const FIREBASE_PROJECT_ID = 'gen-lang-client-0703668573';
const ADMIN_EMAIL = 'ehakun1807@gmail.com';

const PUBLIC_KEYS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

// Hard cap on inline PDF size. Gemini's inline_data limit is ~20MB request
// body; we leave headroom for the JSON envelope + base64 expansion.
const MAX_PDF_BYTES = 15 * 1024 * 1024;

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

// ---------------------------------------------------------------------------
// Response schema — kept tight on purpose. Comments are short by design;
// the user explicitly asked for "short & informative, no deep dive".
// ---------------------------------------------------------------------------

const CATEGORIES = ['grammar', 'gmp', 'logic', 'image', 'numbering'] as const;
type Category = (typeof CATEGORIES)[number];
const SEVERITIES = ['high', 'medium', 'low'] as const;
type Severity = (typeof SEVERITIES)[number];

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      description:
        'Each finding = one short, actionable comment tied to a page. Keep ≤ 200 chars.',
      items: {
        type: 'object',
        properties: {
          page: {
            type: 'integer',
            description: '1-indexed page number this finding belongs to.'
          },
          category: {
            type: 'string',
            enum: [...CATEGORIES],
            description:
              'grammar=typo/grammar/wording, gmp=format/structure/missing GMP element, logic=DFA/sequence issue, image=figure clarity for operator, numbering=step numbering issue'
          },
          severity: { type: 'string', enum: [...SEVERITIES] },
          comment: {
            type: 'string',
            description:
              'Short informative note (≤ 200 chars). Tell the operator what is wrong and a hint at the fix. No reasoning paragraphs.'
          },
          quote: {
            type: 'string',
            description:
              'Optional: the exact phrase or step label being flagged (≤ 80 chars). Helps the user locate it.'
          }
        },
        required: ['page', 'category', 'severity', 'comment']
      }
    },
    summary: {
      type: 'object',
      properties: {
        pageCount: { type: 'integer' },
        overallVerdict: {
          type: 'string',
          enum: ['pass', 'minor_issues', 'major_issues']
        },
        headline: {
          type: 'string',
          description: 'One sentence overall (≤ 140 chars).'
        }
      },
      required: ['pageCount', 'overallVerdict', 'headline']
    }
  },
  required: ['findings', 'summary']
};

const SYSTEM_PROMPT = `You are a senior manufacturing-document QA reviewer. You audit work instructions, assembly procedures, SOPs, and similar shop-floor documents for hardware companies.

Audit the attached PDF against the following dimensions. Be concise — every finding must be a short, actionable note (≤ 200 chars). No reasoning paragraphs. No reasoning about your reasoning.

1. Grammar, spelling, typos, awkward wording.
2. Step numbering — gaps, duplicates, out-of-order, inconsistent format (e.g. "1." vs "Step 1" mixed).
3. Document format & structure per GMP rules of thumb — presence of: title block, document ID + revision, effective date, author/approver, scope, materials/tools list, safety/PPE callouts, acceptance criteria, revision history. Missing or weak sections = a finding.
4. Logical order of assembly / process steps from a Design-for-Assembly perspective — e.g. fasteners called out before the parts they secure, torque before the part is positioned, cleaning step after a contaminating step, etc.
5. Image / figure clarity for the operator — does the figure actually show the action and emphasize the assembly step? Wrong angle, missing callouts, ambiguous orientation, no scale, not matched to the step text — flag it.

Hard rules:
- Each finding belongs to exactly ONE page (1-indexed).
- Comments are short. No "this is because…" — just the issue and a fix hint.
- Skip cosmetic nits if the document is otherwise dense with substantive issues.
- If the document is clean, return an empty findings array and overallVerdict='pass'.
- Cap output at ~30 findings. Prioritize high-severity over low.

Severity:
- high  = blocks correct execution / safety / GMP non-conformance
- medium = degrades clarity or compliance, but operator could still complete the step
- low   = polish (typos, formatting consistency)

Return JSON per the provided schema.`;

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

export const config = {
  // Allow larger request bodies for inline PDF base64.
  api: {
    bodyParser: {
      sizeLimit: '25mb'
    }
  }
};

export default async function handler(req: ReqLike, res: ResLike) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const auth = req.headers.authorization;
  const authHeader = Array.isArray(auth) ? auth[0] : auth;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing auth' });
  }
  const token = authHeader.slice('Bearer '.length);

  let payload: FirebasePayload;
  try {
    payload = await verifyFirebaseToken(token);
  } catch (err: any) {
    console.warn('JWT verify failed:', err?.message);
    return res.status(401).json({ error: 'invalid token' });
  }

  if (
    payload.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase() ||
    payload.email_verified !== true
  ) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY env var not set');
    return res.status(500).json({ error: 'server not configured' });
  }

  const pdfBase64 = req.body?.pdfBase64 as string | undefined;
  const fileName = (req.body?.fileName as string | undefined) || 'document.pdf';
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({ error: 'missing pdfBase64' });
  }
  // Quick size sanity check (base64 is ~4/3 of raw byte size).
  const approxBytes = Math.floor((pdfBase64.length * 3) / 4);
  if (approxBytes > MAX_PDF_BYTES) {
    return res.status(413).json({
      error: `PDF too large (~${Math.round(approxBytes / 1024 / 1024)}MB). Max ${MAX_PDF_BYTES / 1024 / 1024}MB.`
    });
  }

  let geminiRes: Response;
  try {
    geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: SYSTEM_PROMPT },
                {
                  inline_data: {
                    mime_type: 'application/pdf',
                    data: pdfBase64
                  }
                },
                {
                  text: `File name: ${fileName}\n\nPlease audit this PDF and return findings per the schema.`
                }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.4,
            maxOutputTokens: 8192
          }
        })
      }
    );
  } catch (err: any) {
    console.error('Gemini fetch failed:', err);
    return res.status(502).json({ error: 'ai service unreachable' });
  }

  if (!geminiRes.ok) {
    const txt = await geminiRes.text().catch(() => '');
    console.error('Gemini error:', geminiRes.status, txt);
    return res.status(502).json({ error: 'ai service error' });
  }

  const data: any = await geminiRes.json();
  const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const finishReason = data?.candidates?.[0]?.finishReason;
  if (!textOut) {
    console.error('Empty Gemini response:', JSON.stringify(data).slice(0, 500));
    return res.status(502).json({ error: 'empty ai response' });
  }

  let parsed: any;
  try {
    parsed = JSON.parse(textOut);
  } catch (err) {
    console.error(
      'Failed to parse Gemini JSON. finishReason=',
      finishReason,
      'text=',
      textOut.slice(0, 800)
    );
    if (finishReason === 'MAX_TOKENS') {
      return res
        .status(502)
        .json({ error: 'ai response too long — try a shorter doc' });
    }
    return res.status(502).json({ error: 'ai returned invalid json' });
  }

  // Normalize + clamp on the way out so the client always gets a clean shape.
  const findings = Array.isArray(parsed.findings)
    ? parsed.findings
        .filter((f: any) => f && typeof f === 'object')
        .map((f: any) => ({
          page: Math.max(1, Math.floor(Number(f.page) || 1)),
          category: (CATEGORIES as readonly string[]).includes(f.category)
            ? (f.category as Category)
            : 'gmp',
          severity: (SEVERITIES as readonly string[]).includes(f.severity)
            ? (f.severity as Severity)
            : 'medium',
          comment: String(f.comment || '').slice(0, 200),
          quote: f.quote ? String(f.quote).slice(0, 80) : undefined
        }))
        .slice(0, 50)
    : [];

  const summary = parsed.summary || {};
  return res.status(200).json({
    findings,
    summary: {
      pageCount: Math.max(1, Math.floor(Number(summary.pageCount) || 1)),
      overallVerdict:
        summary.overallVerdict === 'pass' ||
        summary.overallVerdict === 'minor_issues' ||
        summary.overallVerdict === 'major_issues'
          ? summary.overallVerdict
          : findings.length === 0
            ? 'pass'
            : findings.some((f: any) => f.severity === 'high')
              ? 'major_issues'
              : 'minor_issues',
      headline: String(summary.headline || '').slice(0, 200)
    },
    generatedAt: Date.now()
  });
}
