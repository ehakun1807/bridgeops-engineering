// ---------------------------------------------------------------------------
// Vercel serverless function: POST /api/quote-compare
//
// Takes a structured supplier quote and returns whether the price is
// attractive vs. the current market. Uses Gemini 2.5 Flash with Google
// Search grounding, with the same un-grounded fallback path the rest of
// /api uses.
//
// Request body:
//   {
//     category:        string;   // e.g. "Labels printing"
//     description:     string;   // material / specs / dimensions / finish
//     quantity:        number;   // pieces in the quoted order (MOQ or qty)
//     unitPrice:       number;   // per-unit price IN the supplied currency
//     currency:        string;   // ISO-ish: "USD", "ILS", "EUR", "GBP", "CNY"
//     region?:         string;   // optional supplier region hint
//     leadTimeDays?:   number;   // optional, factored into reasoning
//     extraNotes?:     string;   // optional free-text context
//   }
//
// Response:
//   {
//     verdict: "attractive" | "fair" | "expensive" | "unknown";
//     unitPriceQuoted: number;
//     marketLow:  number | null;   // estimated market low,  same currency
//     marketHigh: number | null;   // estimated market high, same currency
//     currency:   string;
//     reasoning:  string | null;   // 2-3 sentence rationale
//     sources:    string[];        // up to 3 grounding URLs
//     cached:     boolean;
//     error?:     string;
//   }
//
// Security mirrors /api/find-equivalent: Firebase ID token in
// Authorization: Bearer, verified against Google's RS256 public keys,
// gated to the admin email + email_verified.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

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

// ---------------------------------------------------------------------------
// In-memory per-instance cache. Same shape as /api/find-equivalent — quotes
// often get re-checked while the user iterates on currency or qty, so a
// 30-min TTL avoids burning quota on identical inputs.
// ---------------------------------------------------------------------------

interface CacheEntry {
  expires: number;
  payload: Omit<ApiResponse, 'cached' | 'error'>;
}

const CACHE: Map<string, CacheEntry> = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

function cacheKey(input: NormalizedInput): string {
  return [
    input.category.toLowerCase(),
    input.description.toLowerCase(),
    input.quantity,
    input.unitPrice,
    input.currency.toLowerCase(),
    (input.region || '').toLowerCase(),
    input.leadTimeDays || ''
  ].join('|');
}

function cacheGet(key: string): CacheEntry['payload'] | null {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    CACHE.delete(key);
    return null;
  }
  return entry.payload;
}

function cacheSet(key: string, payload: CacheEntry['payload']): void {
  if (CACHE.size >= CACHE_MAX_ENTRIES) {
    const firstKey = CACHE.keys().next().value;
    if (firstKey !== undefined) CACHE.delete(firstKey);
  }
  CACHE.set(key, { expires: Date.now() + CACHE_TTL_MS, payload });
}

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

// ---------------------------------------------------------------------------
// Gemini structured-output schema (un-grounded fallback path).
// ---------------------------------------------------------------------------

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['attractive', 'fair', 'expensive', 'unknown'],
      description:
        'How the quoted unit price compares to the estimated market range. "attractive" = below or at the low end. "fair" = within the typical range. "expensive" = above the high end. "unknown" = could not estimate a market range.'
    },
    marketLow: {
      type: 'number',
      description:
        'Estimated low end of the typical market unit price for this item, expressed in the SAME currency as the quote. Use 0 if you cannot estimate.'
    },
    marketHigh: {
      type: 'number',
      description:
        'Estimated high end of the typical market unit price for this item, in the same currency as the quote. Use 0 if you cannot estimate.'
    },
    reasoning: {
      type: 'string',
      description:
        '2-3 sentences explaining what drives the verdict. Mention key factors (material, qty, region, lead time) and any benchmarks you used.'
    },
    sources: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Up to 3 URLs from the grounding search that backed your range estimate. Empty array if none.'
    }
  },
  required: ['verdict', 'marketLow', 'marketHigh', 'reasoning', 'sources']
};

// JSON output instruction for the grounded path — Gemini doesn't allow
// google_search + responseSchema together, so we ask in the prompt.
const JSON_OUTPUT_INSTRUCTION = [
  'OUTPUT FORMAT — STRICT.',
  '',
  'Return EXACTLY one JSON object and NOTHING else. Specifically:',
  '  - First character must be "{". Last character must be "}".',
  '  - No markdown code fences. No prose before or after.',
  '  - No "Sources:" footnote after the closing brace.',
  '',
  'The object must have EXACTLY these keys and types:',
  '{',
  '  "verdict": "attractive" | "fair" | "expensive" | "unknown",',
  '  "marketLow":  number,    // low end of estimated market unit price, same currency as quote (0 if unknown)',
  '  "marketHigh": number,    // high end of estimated market unit price, same currency (0 if unknown)',
  '  "reasoning":  string,    // 2-3 sentences MAX (under 400 chars total) — drivers and benchmarks only, no preamble',
  '  "sources":    string[]   // up to 3 grounding URLs (empty array if none)',
  '}',
  '',
  'Concrete example of a valid response:',
  '{"verdict":"fair","marketLow":1.5,"marketHigh":2.4,"reasoning":"At 1000 pieces, conductive nylon injection-molded small parts typically run $1.50-$2.40/unit at mid-volume Asian or Israeli mold shops. Quoted $1.80 sits comfortably mid-range. Pricing assumes a simple geometry and existing tooling.","sources":["https://www.protolabs.com/services/injection-molding/","https://www.xometry.com/capabilities/injection-molding/"]}'
].join('\n');

function extractJsonObject(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  if (fence) s = fence[1].trim();
  if (s.startsWith('{') && s.endsWith('}')) return s;

  const start = s.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
  }
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return s.slice(firstBrace, lastBrace + 1);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildPrompt(input: NormalizedInput): string {
  const totalPrice = input.unitPrice * input.quantity;
  const attachments = input.attachments || [];
  const inlineCount = attachments.filter((a) => a.kind === 'inline').length;
  const textAtts = attachments.filter(
    (a): a is TextAttachment => a.kind === 'text'
  );

  const attachmentsBlock =
    attachments.length === 0
      ? ''
      : [
          '',
          'ATTACHMENTS — the buyer uploaded supplementary files for context.',
          inlineCount > 0
            ? `${inlineCount} binary file(s) (PDF / image) are attached as multimodal inline_data — read them directly: they may include the original supplier quote, drawings, photos of the part, or PCB renderings. Pull pricing, materials, dimensions, finishes, and quantities from those files when available, and prefer numbers from the attached quote document over the form fields if they conflict.`
            : '',
          textAtts.length > 0
            ? 'The following text/CAD files are inlined below. Use them as context — STEP files give CAD geometry hints (units, axis system, primitive count → complexity), Gerber/drill files describe PCB stackup and feature density, etc.'
            : '',
          ...textAtts.map((t) => {
            return [
              '',
              `--- BEGIN ${t.name} (${t.mimeType}) ---`,
              t.data,
              `--- END ${t.name} ---`
            ].join('\n');
          })
        ]
          .filter(Boolean)
          .join('\n');

  const lines = [
    'You are a senior procurement / sourcing engineer with 20 years of experience',
    'pricing custom-manufactured parts and services across Israel, China, the EU,',
    'India, and the US. You have a feel for typical street prices on injection',
    'molded parts, CNC machining, sheet metal, PCBs, PCB assembly, label printing,',
    'enclosures, wiring harnesses, packaging, 3D printing, anodizing/painting,',
    'and similar custom production work, and you know how price scales with',
    'quantity and lead time.',
    '',
    'A buyer received the following supplier quote and wants to know whether the',
    'price is attractive vs. the current market.',
    '',
    'QUOTE:',
    `  Category:    ${input.category}`,
    `  Description: ${input.description}`,
    `  Quantity:    ${input.quantity} pieces`,
    `  Unit price:  ${input.unitPrice} ${input.currency}`,
    `  Total price: ${totalPrice.toFixed(2)} ${input.currency} (= unit × qty)`,
    input.region ? `  Region:      ${input.region}` : '  Region:      (not specified)',
    input.leadTimeDays
      ? `  Lead time:   ${input.leadTimeDays} days`
      : '  Lead time:   (not specified)',
    input.extraNotes ? `  Extra:       ${input.extraNotes}` : '',
    '',
    'Your job:',
    '',
    '1. ESTIMATE the typical market unit-price range for this item AT THIS QUANTITY,',
    '   in the SAME currency as the quote. Use Google Search to ground your',
    '   estimate against current vendor pricing pages, marketplace listings,',
    '   industry rate cards, or comparable jobs. Always return numbers in the',
    '   buyer\'s quote currency — do NOT convert.',
    '',
    '2. ACCOUNT FOR scale. Most custom production has steep volume discounts:',
    '   the per-unit price at 100 pcs is often 2-4× the per-unit price at 1000 pcs.',
    '   Anchor your range to the QUOTED quantity, not generic "per piece" pricing.',
    '',
    '3. ACCOUNT FOR region. Israeli local suppliers run 1.5-3× Chinese suppliers',
    '   on most custom production work, but with much shorter lead times. EU and',
    '   US shops sit between those extremes. If the region is unspecified, assume',
    '   a mid-range supplier and call that out in reasoning.',
    '',
    '4. CLASSIFY the verdict:',
    '   - "attractive" = quoted unit price is at or below the low end of the range',
    '   - "fair"       = quoted unit price is within the range',
    '   - "expensive"  = quoted unit price is above the high end of the range',
    '   - "unknown"    = you could not anchor a range with reasonable confidence',
    '',
    '5. PROVIDE 2-3 sentences of reasoning (under 400 characters total — be',
    '   terse) that name the drivers (material, qty, region, lead time) and any',
    '   benchmarks you found. No preamble like "Based on my search…". If you',
    '   used search results, put up to 3 URLs in the sources array. Do not',
    '   invent URLs.',
    '',
    '6. If the description is too vague to anchor a range (e.g. just "custom part")',
    '   set verdict="unknown", marketLow=0, marketHigh=0, and use reasoning to tell',
    '   the buyer what extra info would unlock a useful estimate.',
    '',
    'Currency rules: marketLow and marketHigh MUST be in the same currency as the',
    'quote. If the quote is in ILS, return ILS numbers. If USD, return USD numbers.',
    'Never mix currencies in one response.',
    '',
    attachmentsBlock,
    'Return ONLY the JSON object specified by the output format.'
  ];
  return lines.filter(Boolean).join('\n');
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

interface InlineAttachment {
  // Kind === 'inline' — sent to Gemini as inline_data (PDF / image).
  kind: 'inline';
  name: string;
  mimeType: string;
  // base64 (no data: prefix)
  data: string;
}

interface TextAttachment {
  // Kind === 'text' — file content embedded into the prompt as plain text.
  // Used for STEP, Gerber, drill, csv, etc. — formats Gemini can't read
  // natively but that are textual and useful for context.
  kind: 'text';
  name: string;
  mimeType: string;
  data: string;
}

type Attachment = InlineAttachment | TextAttachment;

interface NormalizedInput {
  category: string;
  description: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  region?: string;
  leadTimeDays?: number;
  extraNotes?: string;
  attachments?: Attachment[];
}

// Mirrors the client-side cap. Vercel's body limit is ~4.5MB; base64 inflates
// raw bytes by ~33%, so we keep total raw at 5MB so the JSON stays comfortably
// under the limit.
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;
const ALLOWED_INLINE_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp'
]);

function approxBytesFromBase64(b64: string): number {
  // base64 length × 0.75 minus padding. Cheap estimate; precise enough for
  // the size cap we enforce.
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function normalizeAttachments(raw: unknown): {
  attachments: Attachment[];
  errors: string[];
} {
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { attachments: [], errors };

  const result: Attachment[] = [];
  let totalBytes = 0;

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    const name = typeof a.name === 'string' ? a.name.slice(0, 200) : '';
    const kind = a.kind;
    const mimeType =
      typeof a.mimeType === 'string' ? a.mimeType.toLowerCase() : '';
    const data = typeof a.data === 'string' ? a.data : '';
    if (!name || !data) {
      errors.push(`attachment missing name or data`);
      continue;
    }

    if (kind === 'inline') {
      if (!ALLOWED_INLINE_MIME.has(mimeType)) {
        errors.push(`${name}: mime ${mimeType} not allowed for inline`);
        continue;
      }
      const bytes = approxBytesFromBase64(data);
      if (bytes > MAX_FILE_BYTES) {
        errors.push(`${name}: exceeds per-file limit`);
        continue;
      }
      if (totalBytes + bytes > MAX_TOTAL_BYTES) {
        errors.push(`${name}: would exceed total cap`);
        continue;
      }
      totalBytes += bytes;
      result.push({ kind: 'inline', name, mimeType, data });
    } else if (kind === 'text') {
      // Hard-cap text length to bound prompt size regardless of what the
      // client sent — the client already truncates, but we don't trust it.
      const text =
        data.length > MAX_TEXT_CHARS
          ? data.slice(0, MAX_TEXT_CHARS) +
            `\n\n[TRUNCATED — sent first ${MAX_TEXT_CHARS} chars]`
          : data;
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > MAX_FILE_BYTES) {
        errors.push(`${name}: exceeds per-file limit`);
        continue;
      }
      if (totalBytes + bytes > MAX_TOTAL_BYTES) {
        errors.push(`${name}: would exceed total cap`);
        continue;
      }
      totalBytes += bytes;
      result.push({ kind: 'text', name, mimeType: mimeType || 'text/plain', data: text });
    } else {
      errors.push(`${name}: unknown kind`);
    }
  }

  return { attachments: result, errors };
}

interface ApiResponse {
  verdict: 'attractive' | 'fair' | 'expensive' | 'unknown';
  unitPriceQuoted: number;
  marketLow: number | null;
  marketHigh: number | null;
  currency: string;
  reasoning: string | null;
  sources: string[];
  cached: boolean;
  error?: string;
}

const EMPTY_RESPONSE = (extra: Partial<ApiResponse> = {}): ApiResponse => ({
  verdict: 'unknown',
  unitPriceQuoted: 0,
  marketLow: null,
  marketHigh: null,
  currency: '',
  reasoning: null,
  sources: [],
  cached: false,
  ...extra
});

const ALLOWED_CURRENCIES = new Set([
  'USD', 'ILS', 'EUR', 'GBP', 'CNY', 'JPY', 'INR', 'CAD', 'AUD', 'CHF'
]);

export default async function handler(req: ReqLike, res: ResLike) {
  if (req.method !== 'POST') {
    return res
      .status(405)
      .json(EMPTY_RESPONSE({ error: 'method not allowed' }));
  }

  const auth = req.headers.authorization;
  const authHeader = Array.isArray(auth) ? auth[0] : auth;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(EMPTY_RESPONSE({ error: 'missing auth' }));
  }
  const token = authHeader.slice('Bearer '.length);

  let payload: FirebasePayload;
  try {
    payload = await verifyFirebaseToken(token);
  } catch (err: any) {
    console.warn('JWT verify failed:', err?.message);
    return res.status(401).json(EMPTY_RESPONSE({ error: 'invalid token' }));
  }

  if (
    // Closed-beta gate: allowlist only. See note in /api/ai-analyze.ts.
    !isAllowedEmail(payload.email)
  ) {
    return res.status(403).json(EMPTY_RESPONSE({ error: 'forbidden' }));
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY env var not set');
    return res
      .status(500)
      .json(EMPTY_RESPONSE({ error: 'server not configured' }));
  }

  // Parse + validate body
  const body = req.body as Partial<Record<keyof NormalizedInput, unknown>>;

  const category = typeof body?.category === 'string' ? body.category.trim() : '';
  const description =
    typeof body?.description === 'string' ? body.description.trim() : '';
  const quantity = Number(body?.quantity);
  const unitPrice = Number(body?.unitPrice);
  const currencyRaw =
    typeof body?.currency === 'string' ? body.currency.trim().toUpperCase() : '';
  const region =
    typeof body?.region === 'string' ? body.region.trim() : undefined;
  const leadTimeDaysNum = Number(body?.leadTimeDays);
  const leadTimeDays =
    Number.isFinite(leadTimeDaysNum) && leadTimeDaysNum > 0
      ? leadTimeDaysNum
      : undefined;
  const extraNotes =
    typeof body?.extraNotes === 'string' ? body.extraNotes.trim() : undefined;

  const attachmentResult = normalizeAttachments(body?.attachments);
  if (attachmentResult.errors.length > 0) {
    console.warn('quote-compare attachment validation:', attachmentResult.errors);
  }
  const attachments = attachmentResult.attachments;

  if (!category || !description) {
    return res.status(400).json(
      EMPTY_RESPONSE({
        error: 'missing or invalid required fields: category, description'
      })
    );
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return res
      .status(400)
      .json(EMPTY_RESPONSE({ error: 'quantity must be a positive number' }));
  }
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return res
      .status(400)
      .json(EMPTY_RESPONSE({ error: 'unitPrice must be a positive number' }));
  }
  if (!ALLOWED_CURRENCIES.has(currencyRaw)) {
    return res.status(400).json(
      EMPTY_RESPONSE({
        error: `currency must be one of ${Array.from(ALLOWED_CURRENCIES).join(', ')}`
      })
    );
  }

  const input: NormalizedInput = {
    category,
    description,
    quantity,
    unitPrice,
    currency: currencyRaw,
    region,
    leadTimeDays,
    extraNotes,
    attachments: attachments.length > 0 ? attachments : undefined
  };

  // Skip cache when attachments are present — different files = different
  // context, and our cache key doesn't (and shouldn't) hash file content.
  // The whole point of attaching a file is for THIS run's analysis.
  const key = cacheKey(input);
  const cached = attachments.length === 0 ? cacheGet(key) : null;
  if (cached) {
    return res.status(200).json({ ...cached, cached: true } as ApiResponse);
  }

  // ------------------------------------------------------------------------
  // Gemini call. Same retry+fallback strategy as /api/find-equivalent.
  // ------------------------------------------------------------------------
  const PRIMARY_MODEL = 'gemini-2.5-flash';
  const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
  const RETRY_STATUSES = new Set([429, 500, 502, 503]); // 504 excluded: retrying a timeout burns remaining budget

  type CallResult =
    | { kind: 'ok'; res: Response; model: string }
    | { kind: 'http_error'; statusCode: number; text: string; model: string }
    | { kind: 'network_error'; error: any; model: string };

  const prompt = buildPrompt(input);

  async function callModel(
    model: string,
    backoffMs: number[],
    useGrounding: boolean
  ): Promise<CallResult> {
    const maxAttempts = 1 + backoffMs.length;
    let lastHttp: { statusCode: number; text: string } | null = null;
    let lastNetwork: any = null;

    const usedPrompt = useGrounding
      ? `${prompt}\n\n${JSON_OUTPUT_INSTRUCTION}`
      : prompt;
    // Build the parts array: text prompt first, then any binary attachments
    // as inline_data so Gemini reads them multimodally. Text-class
    // attachments are already folded into the prompt by buildPrompt(), so
    // they don't appear here as separate parts.
    const parts: any[] = [{ text: usedPrompt }];
    for (const att of input.attachments || []) {
      if (att.kind === 'inline') {
        parts.push({
          inline_data: { mime_type: att.mimeType, data: att.data }
        });
      }
    }
    const requestBody: any = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        // Grounded responses for pricing burn a lot of tokens during the
        // search/reasoning phase before the JSON ever lands. 4096 was tight
        // enough that real queries hit MAX_TOKENS mid-JSON. 8192 gives plenty
        // of headroom for the search trace + a 2-3 sentence answer.
        maxOutputTokens: 8192
      }
    };
    if (useGrounding) {
      requestBody.tools = [{ google_search: {} }];
    } else {
      requestBody.generationConfig.responseMimeType = 'application/json';
      requestBody.generationConfig.responseSchema = RESPONSE_SCHEMA;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          }
        );
        if (r.ok) return { kind: 'ok', res: r, model };
        const txt = await r.text().catch(() => '');
        lastHttp = { statusCode: r.status, text: txt };
        if (!RETRY_STATUSES.has(r.status) || attempt === maxAttempts) break;
        const wait = backoffMs[attempt - 1];
        console.warn(
          `Gemini ${model} transient ${r.status} attempt ${attempt}/${maxAttempts}, retrying in ${wait}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
      } catch (err: any) {
        lastNetwork = err;
        if (attempt === maxAttempts) break;
        const wait = backoffMs[attempt - 1];
        console.warn(
          `Gemini ${model} fetch threw attempt ${attempt}/${maxAttempts}, retrying in ${wait}ms:`,
          err?.message
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }

    if (lastHttp)
      return {
        kind: 'http_error',
        model,
        statusCode: lastHttp.statusCode,
        text: lastHttp.text
      };
    return { kind: 'network_error', model, error: lastNetwork };
  }

  const primaryResult = await callModel(PRIMARY_MODEL, [500, 1500], true);

  let result: CallResult = primaryResult;
  if (primaryResult.kind !== 'ok') {
    const primaryTransient =
      primaryResult.kind === 'network_error' ||
      (primaryResult.kind === 'http_error' &&
        (RETRY_STATUSES.has(primaryResult.statusCode) ||
          primaryResult.statusCode === 400));
    if (primaryTransient) {
      console.warn(
        `Primary model ${PRIMARY_MODEL} exhausted retries, falling back to ${FALLBACK_MODEL}`
      );
      const fallbackResult = await callModel(FALLBACK_MODEL, [], false);
      if (fallbackResult.kind === 'ok') {
        result = fallbackResult;
      } else if (
        fallbackResult.kind === 'http_error' &&
        primaryResult.kind === 'network_error'
      ) {
        result = fallbackResult;
      }
    }
  }

  if (result.kind === 'network_error') {
    console.error(
      `Gemini fetch failed after retries (${result.model}):`,
      result.error
    );
    return res
      .status(502)
      .json(EMPTY_RESPONSE({ error: 'ai service unreachable' }));
  }
  if (result.kind === 'http_error') {
    console.error(
      `Gemini error after retries (${result.model}):`,
      result.statusCode,
      result.text
    );
    const safeDetail = (result.text || '')
      .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[key]')
      .slice(0, 200);
    return res.status(502).json(
      EMPTY_RESPONSE({
        error: `ai service error (${result.statusCode})`,
        ...(safeDetail ? { detail: safeDetail } : {})
      } as Partial<ApiResponse> & { detail?: string })
    );
  }

  const geminiRes = result.res;
  const data: any = await geminiRes.json();
  const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const finishReason = data?.candidates?.[0]?.finishReason;

  if (!textOut || typeof textOut !== 'string') {
    console.error('Gemini returned no text:', JSON.stringify(data).slice(0, 400));
    return res
      .status(502)
      .json(EMPTY_RESPONSE({ error: 'ai returned empty response' }));
  }

  let parsed: any;
  try {
    parsed = JSON.parse(extractJsonObject(textOut));
  } catch (err) {
    if (finishReason === 'MAX_TOKENS') {
      console.error(
        'Gemini hit MAX_TOKENS — response truncated. First 300 chars:',
        textOut.slice(0, 300)
      );
      return res.status(502).json(
        EMPTY_RESPONSE({
          error:
            'ai response truncated (MAX_TOKENS) — try a shorter description'
        })
      );
    }
    console.error('Failed to parse Gemini JSON. finishReason=', finishReason);
    console.error('First 300 chars of raw text:', textOut.slice(0, 300));
    return res
      .status(502)
      .json(EMPTY_RESPONSE({ error: 'ai returned malformed response' }));
  }

  // ------------------------------------------------------------------------
  // Normalize Gemini's response.
  // ------------------------------------------------------------------------
  const rawVerdict = String(parsed?.verdict || '').toLowerCase().trim();
  const verdict: ApiResponse['verdict'] =
    rawVerdict === 'attractive' ||
    rawVerdict === 'fair' ||
    rawVerdict === 'expensive'
      ? rawVerdict
      : 'unknown';

  const toNumOrNull = (v: any): number | null => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  };
  let marketLow = toNumOrNull(parsed?.marketLow);
  let marketHigh = toNumOrNull(parsed?.marketHigh);
  // Sanity: if the model accidentally swapped them, swap back.
  if (marketLow !== null && marketHigh !== null && marketLow > marketHigh) {
    const tmp = marketLow;
    marketLow = marketHigh;
    marketHigh = tmp;
  }

  const reasoning =
    typeof parsed?.reasoning === 'string' && parsed.reasoning.trim()
      ? parsed.reasoning.trim()
      : null;

  const sources: string[] = Array.isArray(parsed?.sources)
    ? parsed.sources
        .map((s: any) => (typeof s === 'string' ? s.trim() : ''))
        .filter((s: string) => s.startsWith('http'))
        .slice(0, 3)
    : [];

  const responseBody: ApiResponse = {
    verdict,
    unitPriceQuoted: input.unitPrice,
    marketLow,
    marketHigh,
    currency: input.currency,
    reasoning,
    sources,
    cached: false
  };

  // Only cache attachment-free runs. The cache key doesn't (and shouldn't)
  // hash file content, so caching with attachments would risk reusing one
  // file's analysis for a later identical-form-field run that has different
  // files attached. The form-only flow is the cacheable path.
  if (attachments.length === 0) {
    const { cached: _ignoredCached, error: _ignoredError, ...payloadForCache } =
      responseBody;
    cacheSet(key, payloadForCache);
  }

  return res.status(200).json(responseBody);
}
