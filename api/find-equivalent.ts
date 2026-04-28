// ---------------------------------------------------------------------------
// Vercel serverless function: POST /api/find-equivalent
//
// Looks up an electronic component by manufacturer + part number and asks
// Gemini 2.5 Flash (with Google Search grounding) for a current, real-world
// equivalent. Returns:
//
//   {
//     equivalent: string | null;        // human-readable description, e.g.
//                                       // "Kyocera AVX 04025U1R5CAT2A — 0402
//                                       //  1.5pF C0G/NP0 25V MLCC"
//     newPartNumber: string | null;     // suggested replacement part number
//                                       // (may equal the input if the part
//                                       // is still in production and no
//                                       // change is needed)
//     confidence: "exact" | "spec-based" | null;
//     source: "gemini" | null;          // (kept for forward-compat / cache key)
//     sourceUrl: string | null;         // datasheet or distributor URL when
//                                       // grounding produced one
//     notes: string | null;             // 1-2 sentences of context (what the
//                                       // part is, why this is an equivalent,
//                                       // or why no equivalent could be found)
//     cached: boolean;
//     error?: string;
//   }
//
// Security mirrors /api/ai-coach and /api/ai-analyze:
// - Caller must send a Firebase ID token in Authorization: Bearer <token>.
// - Token is verified against Google's public RS256 keys.
// - Only the admin email (ehakun1807@gmail.com) is allowed through to
//   protect the Gemini quota.
//
// History note: an earlier version of this endpoint scraped Digi-Key and
// Mouser HTML directly. Both sites block bot User-Agents at the WAF and
// render results client-side, so the scraper returned empty 100% of the
// time — every BOM row showed "Not found". Replaced with grounded Gemini.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

// NOTE: We deliberately don't import any Firebase Web SDK code here. That
// SDK initializes browser-oriented modules at import time and can crash a
// Vercel Node serverless function with a generic 500 (no parseable response
// body) — which is exactly the regression that took out an earlier version
// of this endpoint.
//
// In place of the Firestore cache we use a simple in-memory Map at module
// scope (see CACHE below). It persists across requests on the same Vercel
// function instance (typically 5-15 min) and gets blown away on cold start.
// That's fine for the dominant use case: running the same BOM twice in
// quick succession while iterating, or repeating an analysis after a
// transient Gemini hiccup. For multi-day caching across instances the right
// move is Firebase Admin SDK with a service-account credential — not added
// here because current usage doesn't justify the setup overhead.

const FIREBASE_PROJECT_ID = 'gen-lang-client-0703668573';
const ADMIN_EMAIL = 'ehakun1807@gmail.com';

// ---------------------------------------------------------------------------
// In-memory cache (per function instance).
//
// Keyed on normalized manufacturer + part number; entries TTL after 30
// minutes of wall-clock time so we don't serve genuinely stale data even
// if a function instance lives unusually long. Capped at 500 entries with
// FIFO-ish eviction (oldest insertion wins on overflow) to bound memory.
// ---------------------------------------------------------------------------

interface CacheEntry {
  expires: number;
  payload: Omit<ApiResponse, 'cached' | 'error'>;
}

const CACHE: Map<string, CacheEntry> = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

function cacheKey(manufacturer: string, partNumber: string): string {
  return `${manufacturer.toLowerCase().trim()}|${partNumber.toLowerCase().trim()}`;
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
    // Drop the oldest entry. Map iteration order is insertion order, so
    // the first key is the oldest.
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
// Gemini structured-output schema (used on the un-grounded fallback path).
// ---------------------------------------------------------------------------

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    identification: {
      type: 'string',
      description:
        'What the component IS — package, value, tolerance, voltage, dielectric / function / pinout etc., decoded from the part number using the manufacturer\'s naming convention. Always fill this in if you can decode any part of the number, even when no replacement is recommended. Empty string ONLY if the part number is total gibberish.'
    },
    equivalent: {
      type: 'string',
      description:
        'Short human-readable description of the recommended replacement, including manufacturer + part number. Empty string if no recommendation can be made.'
    },
    newPartNumber: {
      type: 'string',
      description:
        'The recommended replacement part number. May equal the input part number if the original is still in production. Empty string if no recommendation.'
    },
    alternatives: {
      type: 'array',
      description:
        'Up to 2 additional spec-equivalent parts from other vendors (e.g. ["Murata GRM1555C1H1R5BA01D", "TDK CGA2B2C0G1H1R5C050BA"]). Helps the engineer compare second-source options. Empty array if none.',
      items: { type: 'string' }
    },
    confidence: {
      type: 'string',
      enum: ['exact', 'spec-based', 'none'],
      description:
        '"exact" = same part still produced or a drop-in pin/spec compatible replacement. "spec-based" = same key electrical/mechanical specs from a different vendor; verify before use. "none" = could not confidently recommend a replacement.'
    },
    notes: {
      type: 'string',
      description:
        '1-2 sentences explaining the recommendation OR why none is possible. Include practical guidance — typo corrections ("did you mean RC0402FR-07150RL?"), production status, or what to verify on the datasheet.'
    },
    sourceUrl: {
      type: 'string',
      description:
        'Datasheet URL or distributor product page URL for the recommended part. Empty string if none.'
    }
  },
  required: [
    'identification',
    'equivalent',
    'newPartNumber',
    'alternatives',
    'confidence',
    'notes',
    'sourceUrl'
  ]
};

// JSON output instruction for the grounded path — Gemini doesn't allow
// combining google_search tools with responseSchema, so we ask in prompt.
const JSON_OUTPUT_INSTRUCTION = [
  'Output format — return ONLY a single JSON object. No markdown code fences. No prose before or after.',
  '',
  'The object must have EXACTLY these keys and types:',
  '{',
  '  "identification": string,         // what the part IS, decoded from the part number — always try to fill',
  '  "equivalent": string,             // recommended replacement description; empty string if no recommendation',
  '  "newPartNumber": string,          // recommended replacement part number; empty string if no recommendation',
  '  "alternatives": string[],         // up to 2 additional spec-equivalent options from other vendors',
  '  "confidence": "exact" | "spec-based" | "none",',
  '  "notes": string,                  // 1-2 sentences of useful context, typo correction, or what to verify',
  '  "sourceUrl": string               // datasheet or distributor URL for the recommendation; empty string if none',
  '}',
  '',
  'Critical: the very first character of your response must be "{" and the very last must be "}".'
].join('\n');

function extractJsonObject(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fence) s = fence[1].trim();
  if (s.startsWith('{') && s.endsWith('}')) return s;
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

function buildPrompt(manufacturer: string, partNumber: string): string {
  return [
    'You are a senior electronic-components sourcing engineer with 20 years of experience and deep knowledge of part-numbering conventions across Murata, Kyocera AVX, TDK, Yageo, Vishay, Samsung Electro-Mechanics, Panasonic, Wurth, Texas Instruments, NXP, STMicroelectronics, ON Semi, Analog Devices, Infineon, Maxim/Analog, Linear Technology, IDT/Renesas, Altera/Intel, Lattice, plus the Digi-Key, Mouser, Arrow, and Octopart catalogs.',
    '',
    `Component to look up:`,
    `  Manufacturer: ${manufacturer}`,
    `  Part number:  ${partNumber}`,
    '',
    'Your job, in order:',
    '',
    '1. IDENTIFY the part. Decode the part number using the manufacturer\'s naming convention, even without internet confirmation. For passives, that means reading off package, value, tolerance, voltage, dielectric, temp coefficient. For semiconductors, that means reading off function family, package, speed/voltage/current grade. ALWAYS fill the "identification" field if you can decode anything — this is the most useful output and should rarely be empty.',
    '',
    '2. CORRECT obvious typos. Manufacturer names often arrive abbreviated or merged (e.g. "klkyocera" probably means "Kyocera AVX"; "linear" means "Linear Technology / Analog Devices"; "fairchil" means "Fairchild Semiconductor / ON Semi"; "ti" means "Texas Instruments"; "altera" is now Intel/Altera; "maxim2" likely means "Maxim Integrated / Analog Devices"). Part numbers may have prefix variants (e.g. "RE0402FRE07150" is almost certainly meant to be Yageo "RC0402FR-07150RL" — Yageo has no RE0402 series, but their RC0402 is the standard 0402 thick-film resistor and the trailing 150 = 150Ω). When you spot a probable typo, say so explicitly in the notes ("Likely intended part number: …") and proceed with the decoded part.',
    '',
    '3. RECOMMEND a replacement. Set newPartNumber + equivalent + confidence:',
    '   - If the part is still in production, recommend itself: newPartNumber = the corrected original, confidence = "exact", notes mention "still in production, no change needed".',
    '   - If the part is obsolete or hard to find, recommend a current spec-equivalent from the same vendor or a major second source. confidence = "exact" if the replacement is a confirmed drop-in (same pinout, same electricals), "spec-based" if it matches the key specs but warrants a verification step.',
    '   - For RF/microwave passives (Kyocera AVX U-series, Murata GJM/GQM, Johanson, ATC, etc.), prioritize C0G/NP0 dielectric, Q factor, and ESR matching.',
    '   - For 1%/0.1% precision resistors and bulk capacitors, package size + tolerance + voltage rating + temperature coefficient matter most.',
    '',
    '4. PROVIDE alternatives. Up to 2 additional second-source options from different vendors when reasonable. Format each as "Manufacturer PartNumber — short descriptor".',
    '',
    'Use Google Search to verify production status and find datasheet/distributor links. Trust live search over your training data when they disagree. Do not invent URLs — only include sourceUrl if search returned a real one for the recommended part.',
    '',
    'When you genuinely cannot help:',
    '- Set confidence="none" and leave equivalent / newPartNumber empty.',
    '- BUT still fill identification (with what you could decode) and notes (with what to verify, e.g. "Verify part marking against datasheet — this code does not match standard Kyocera AVX nomenclature; possible OEM private-label code or marketing PN").',
    '- Returning an empty result is the worst outcome. Always provide SOMETHING actionable.',
    '',
    'Return ONLY the JSON object specified by the output format.'
  ].join('\n');
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

interface ApiResponse {
  equivalent: string | null;
  newPartNumber: string | null;
  confidence: 'exact' | 'spec-based' | null;
  source: 'gemini' | null;
  sourceUrl: string | null;
  notes: string | null;
  cached: boolean;
  error?: string;
}

const EMPTY_RESPONSE = (
  extra: Partial<ApiResponse> = {}
): ApiResponse => ({
  equivalent: null,
  newPartNumber: null,
  confidence: null,
  source: null,
  sourceUrl: null,
  notes: null,
  cached: false,
  ...extra
});

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
    payload.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase() ||
    payload.email_verified !== true
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
  const body = req.body as { manufacturer?: unknown; partNumber?: unknown };
  const rawMfg =
    typeof body?.manufacturer === 'string' ? body.manufacturer.trim() : '';
  const rawPart =
    typeof body?.partNumber === 'string' ? body.partNumber.trim() : '';
  if (!rawMfg || !rawPart) {
    return res.status(400).json(
      EMPTY_RESPONSE({
        error: 'missing or invalid required fields: manufacturer, partNumber'
      })
    );
  }

  // Cache lookup. A hit short-circuits the Gemini call entirely, so
  // re-running the same BOM right after a tweak doesn't burn quota.
  const key = cacheKey(rawMfg, rawPart);
  const cached = cacheGet(key);
  if (cached) {
    return res.status(200).json({ ...cached, cached: true } as ApiResponse);
  }


  // ------------------------------------------------------------------------
  // Gemini call. Mirrors the retry+fallback strategy from /api/ai-coach:
  //   1. gemini-2.5-flash with Google Search grounding (2 retries with
  //      exponential-ish backoff).
  //   2. Fallback to gemini-2.5-flash-lite (un-grounded, schema-validated).
  // ------------------------------------------------------------------------
  const PRIMARY_MODEL = 'gemini-2.5-flash';
  const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
  const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

  type CallResult =
    | { kind: 'ok'; res: Response; model: string }
    | { kind: 'http_error'; statusCode: number; text: string; model: string }
    | { kind: 'network_error'; error: any; model: string };

  const prompt = buildPrompt(rawMfg, rawPart);

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
    const requestBody: any = {
      contents: [{ role: 'user', parts: [{ text: usedPrompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024
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
    console.error('Failed to parse Gemini JSON:', textOut.slice(0, 300));
    return res
      .status(502)
      .json(EMPTY_RESPONSE({ error: 'ai returned malformed response' }));
  }

  // ------------------------------------------------------------------------
  // Normalize Gemini's response.
  //
  // Key design choice: we DON'T gate everything on a binary "found" flag.
  // The most useful row, even when no replacement can be confidently
  // recommended, is one that tells the engineer what the part IS. So:
  //
  //   - `equivalent` field always carries the best human-readable
  //     description we have. Priority: explicit equivalent → identification
  //     fallback. This means the on-screen "Equivalent" cell is never blank
  //     for an identifiable part.
  //
  //   - `notes` always carries useful context (typo correction, what to
  //     verify, why no replacement could be recommended), folding in any
  //     `alternatives` Gemini provided so the engineer sees second-source
  //     options inline.
  //
  //   - `confidence` reflects whether a recommendation can be trusted as
  //     drop-in (`exact`), needs verification (`spec-based`), or is absent
  //     (`null` — but a description and notes will still be present).
  // ------------------------------------------------------------------------
  const rawConfidence = String(parsed?.confidence || '').toLowerCase();
  const confidence: 'exact' | 'spec-based' | null =
    rawConfidence === 'exact' || rawConfidence === 'spec-based'
      ? rawConfidence
      : null;

  const trim = (v: any): string =>
    typeof v === 'string' ? v.trim() : '';

  const identification = trim(parsed?.identification);
  const rawEquivalent = trim(parsed?.equivalent);
  const rawNewPart = trim(parsed?.newPartNumber);
  const rawNotes = trim(parsed?.notes);
  const rawSourceUrl = trim(parsed?.sourceUrl);
  const alternatives: string[] = Array.isArray(parsed?.alternatives)
    ? parsed.alternatives
        .map((a: any) => trim(a))
        .filter((a: string) => a.length > 0)
        .slice(0, 3)
    : [];

  // Recommendation present if Gemini gave us a real replacement part number.
  const hasRecommendation = !!rawEquivalent && !!rawNewPart;

  // Description shown in the "Equivalent" column. If Gemini decoded the
  // part but couldn't confidently recommend a replacement, we still show
  // the identification so the row isn't useless.
  const equivalent = hasRecommendation
    ? rawEquivalent
    : identification || null;

  const newPartNumber = hasRecommendation ? rawNewPart : null;

  // Fold alternatives into the notes so the engineer sees second-source
  // options inline without needing a separate column. Order: model's notes
  // first (the rationale), then the alternatives list.
  const notesParts: string[] = [];
  if (rawNotes) notesParts.push(rawNotes);
  if (alternatives.length > 0) {
    notesParts.push(`Alternatives: ${alternatives.join('; ')}`);
  }
  const notes = notesParts.length > 0 ? notesParts.join(' · ') : null;

  const sourceUrl = rawSourceUrl.startsWith('http') ? rawSourceUrl : null;

  const responseBody: ApiResponse = {
    equivalent: equivalent || null,
    newPartNumber,
    // Confidence only meaningful when we're recommending a part. A pure
    // identification (no recommendation) leaves confidence null.
    confidence: hasRecommendation ? confidence : null,
    source: equivalent ? 'gemini' : null,
    sourceUrl,
    notes,
    cached: false
  };

  // Cache the response so the next request for the same part returns
  // instantly. We deliberately cache identifications (descriptive notes
  // even without a recommendation) too — that's still useful output and
  // re-running the same Gemini call won't usefully add to it.
  const { cached: _ignoredCached, error: _ignoredError, ...payloadForCache } =
    responseBody;
  cacheSet(key, payloadForCache);

  return res.status(200).json(responseBody);
}
