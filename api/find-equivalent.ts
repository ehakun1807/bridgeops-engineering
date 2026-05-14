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
import { isAllowedEmail } from '../config.ts';

// NOTE: We deliberately don't import any Firebase Web SDK code here. That
// SDK initializes browser-oriented modules at import time and can crash a
// Vercel Node serverless function with a generic 500 (no parseable response
// body) — which is exactly the regression that took out an earlier version
// of this endpoint. The config.ts import above is safe — it's pure TS with
// no Firebase / browser deps.
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
    componentStatus: {
      type: 'string',
      enum: ['active', 'eol', 'obsolete', 'unknown'],
      description:
        'Production lifecycle status of the ORIGINAL input component (NOT the replacement). "active" = currently produced and broadly available from authorized distributors. "eol" = manufacturer has issued an End-of-Life / Last-Time-Buy notice but the part may still be buyable for a limited time. "obsolete" = no longer produced and not generally available through authorized channels. "unknown" = could not determine status with confidence.'
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
    'componentStatus',
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
//
// We include a concrete example so the model has a clear template to mirror,
// and we hammer the "no prose, no fences, no source citations after the
// closing brace" rule because the grounded path leaks all three when the
// instruction isn't strong.
const JSON_OUTPUT_INSTRUCTION = [
  'OUTPUT FORMAT — STRICT.',
  '',
  'Return EXACTLY one JSON object and NOTHING else. Specifically:',
  '  - The very first character must be "{".',
  '  - The very last character must be "}".',
  '  - No markdown code fences (no ``` or ```json).',
  '  - No prose before, after, or around the JSON.',
  '  - No "Sources:" / citation footnotes after the closing brace.',
  '  - No commentary about your search process.',
  '',
  'The object must have EXACTLY these keys and types:',
  '{',
  '  "identification": string,         // what the part IS, decoded from the part number — always try to fill',
  '  "componentStatus": "active" | "eol" | "obsolete" | "unknown",  // status of the ORIGINAL input part',
  '  "equivalent": string,             // recommended replacement description; empty string if no recommendation',
  '  "newPartNumber": string,          // recommended replacement part number; empty string if no recommendation',
  '  "alternatives": string[],         // up to 2 additional spec-equivalent options from other vendors',
  '  "confidence": "exact" | "spec-based" | "none",',
  '  "notes": string,                  // 1-2 sentences of useful context, typo correction, or what to verify',
  '  "sourceUrl": string               // datasheet or distributor URL for the recommendation; empty string if none',
  '}',
  '',
  'Concrete example of a valid response (your output should follow this exact shape, no more, no less):',
  '{"identification":"Murata GRM155R71H103KA01D — 0402 10nF X7R 50V ±10% MLCC","componentStatus":"active","equivalent":"Murata GRM155R71H103KA01D — 0402 10nF X7R 50V ±10% MLCC","newPartNumber":"GRM155R71H103KA01D","alternatives":["TDK CGA2B3X7R1H103K050BB — 0402 10nF X7R 50V ±10% MLCC","Yageo CC0402KRX7R9BB103 — 0402 10nF X7R 50V ±10% MLCC"],"confidence":"exact","notes":"Currently in production. Equivalent direct replacements verified on Digi-Key.","sourceUrl":"https://www.digikey.com/en/products/detail/murata-electronics/GRM155R71H103KA01D/1641840"}'
].join('\n');

/**
 * Robustly extract a JSON object from a Gemini response.
 *
 * Gemini sometimes ignores the "JSON only" instruction on the grounded
 * path — wrapping the answer in markdown fences, prefacing it with
 * "Here is the JSON:", or appending search-source citations after the
 * closing brace. A naive `JSON.parse(textOut)` then fails for everyone.
 *
 * Strategy, in order:
 *   1. Strip an outer markdown fence (```json ... ``` or ``` ... ```).
 *   2. If the cleaned string is already a balanced JSON object, return it.
 *   3. Walk the string and return the first BALANCED `{...}` block,
 *      respecting string literals (so a `}` inside `"some \"text}"` doesn't
 *      close the outer object). This is more reliable than the naive
 *      "first { to last }" slice when there's prose containing braces
 *      on either side.
 *   4. Fall back to "first { to last }" — better than nothing for
 *      pathological inputs.
 *   5. Return the original raw input as a last resort so the caller's
 *      error logging shows the actual model output.
 */
function extractJsonObject(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();

  // Strip an outer markdown fence if present.
  const fence = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  if (fence) s = fence[1].trim();

  // Already a clean JSON object?
  if (s.startsWith('{') && s.endsWith('}')) return s;

  // Walk for the first balanced {...} block, respecting string escapes.
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
        if (depth === 0) {
          return s.slice(start, i + 1);
        }
      }
    }
  }

  // Fall back to the naive slice — better than handing JSON.parse raw prose.
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
    '3. DETERMINE PRODUCTION STATUS of the ORIGINAL part. This drives the recommendation. Use Google Search to verify the part\'s lifecycle state from authoritative sources — manufacturer\'s product page, Digi-Key/Mouser stock + lifecycle indicator, vendor\'s PCN/EOL announcements, IHS/SiliconExpert listings if surfaced.',
    '   - "active"   = currently produced, broadly stocked at authorized distributors. No PCN/EOL announcement.',
    '   - "eol"      = manufacturer has issued an End-of-Life or Last-Time-Buy notice but the part may still be buyable for a limited window.',
    '   - "obsolete" = no longer produced and not generally stocked at authorized distributors.',
    '   - "unknown"  = could not determine status with confidence (search returned ambiguous or no results).',
    '   Also note for older Altera, Linear Tech, Maxim, Fairchild, IDT parts: the brand merged (Intel/Altera, ADI/Linear, ADI/Maxim, ON/Fairchild, Renesas/IDT) and the original PN may be obsolete even if a renamed equivalent is current. Reflect that reality in componentStatus + notes.',
    '',
    '4. RECOMMEND a replacement BASED ON STATUS. Set newPartNumber + equivalent + confidence:',
    '   - If componentStatus = "active": recommend itself. newPartNumber = the corrected original. confidence = "exact". Notes should say "currently in production, no change needed".',
    '   - If componentStatus = "eol": recommend the manufacturer-suggested replacement if one was announced; otherwise a current drop-in from the same vendor family. Notes should mention the EOL notice and any LTB date you saw.',
    '   - If componentStatus = "obsolete": recommend a current spec-equivalent from a major vendor. confidence = "exact" if pin/spec compatible drop-in, "spec-based" otherwise.',
    '   - If componentStatus = "unknown": still try to recommend a spec-equivalent. confidence = "spec-based". Notes should call out that production status couldn\'t be verified and what the engineer should check.',
    '',
    '   Domain rules:',
    '   - For RF/microwave passives (Kyocera AVX U-series, Murata GJM/GQM, Johanson, ATC, etc.), prioritize C0G/NP0 dielectric, Q factor, and ESR matching.',
    '   - For 1%/0.1% precision resistors and bulk capacitors, package size + tolerance + voltage rating + temperature coefficient matter most.',
    '   - For ICs, the replacement must match: function family, package, pinout, key parametrics (Vcc range, current, speed grade).',
    '',
    '5. PROVIDE alternatives. Up to 2 additional second-source options from different vendors when reasonable. Format each as "Manufacturer PartNumber — short descriptor".',
    '',
    'Use Google Search throughout. Trust live search over your training data when they disagree. Do not invent URLs — only include sourceUrl if search returned a real one for the recommended part.',
    '',
    'When you genuinely cannot help:',
    '- Set confidence="none" and leave equivalent / newPartNumber empty.',
    '- BUT still fill identification (with what you could decode), componentStatus (best guess or "unknown"), and notes (with what to verify, e.g. "Verify part marking against datasheet — this code does not match standard Kyocera AVX nomenclature; possible OEM private-label code or marketing PN").',
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
  // Lifecycle status of the ORIGINAL input part. Populated even when no
  // replacement is recommended, so the engineer always knows whether the
  // part they have is something they can keep ordering. null only on
  // pre-status-feature cached entries or hard error responses.
  componentStatus: 'active' | 'eol' | 'obsolete' | 'unknown' | null;
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
  componentStatus: null,
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
        // The grounded path's response includes identification + equivalent
        // + up to 2 alternatives + notes + sourceUrl, plus the model's
        // internal search reasoning. 1024 was tight enough that some
        // responses got truncated mid-JSON, surfacing as
        // "ai returned malformed response" on the client. 4096 mirrors
        // /api/ai-coach (similar grounded JSON workload) and gives plenty
        // of headroom.
        maxOutputTokens: 4096
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
    // MAX_TOKENS truncation produces unparseable JSON because the closing
    // brace was never emitted. Surface that as a distinct, actionable
    // message instead of a generic "malformed response" — at least the
    // operator can see this is a quota/length issue, not a model issue.
    if (finishReason === 'MAX_TOKENS') {
      console.error(
        'Gemini hit MAX_TOKENS — response truncated. First 300 chars:',
        textOut.slice(0, 300)
      );
      return res.status(502).json(
        EMPTY_RESPONSE({
          error:
            'ai response truncated (MAX_TOKENS) — try simpler manufacturer/part input'
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

  // Tolerant normalization for componentStatus — accept the canonical
  // enum, plus a handful of synonyms the model occasionally produces
  // (e.g. "in production", "discontinued", "nrnd"). Anything we can't
  // map cleanly defaults to "unknown" so the column is never empty.
  const rawStatus = String(parsed?.componentStatus || '').toLowerCase().trim();
  let componentStatus: 'active' | 'eol' | 'obsolete' | 'unknown' = 'unknown';
  if (rawStatus === 'active' || rawStatus === 'in production' || rawStatus === 'production') {
    componentStatus = 'active';
  } else if (
    rawStatus === 'eol' ||
    rawStatus === 'end of life' ||
    rawStatus === 'end-of-life' ||
    rawStatus === 'last time buy' ||
    rawStatus === 'ltb' ||
    rawStatus === 'nrnd' ||
    rawStatus === 'not recommended for new designs'
  ) {
    componentStatus = 'eol';
  } else if (
    rawStatus === 'obsolete' ||
    rawStatus === 'discontinued' ||
    rawStatus === 'eos' ||
    rawStatus === 'end of supply'
  ) {
    componentStatus = 'obsolete';
  }

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
    componentStatus,
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
