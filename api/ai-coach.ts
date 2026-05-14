// ---------------------------------------------------------------------------
// Vercel serverless function: POST /api/ai-coach
//
// Given a single BridgeOps sub-parameter (e.g. "Configuration Control (DMR /
// PLM)") and a product type (e.g. "Medical Device"), asks Gemini 2.5 Flash
// for a structured best-practice coaching card: what good looks like, rules
// of thumb, recommended approach, pitfalls, gate expectations, tooling,
// and reference standards.
//
// Grounding: the primary model call is grounded with Google Search so that
// standards (which get withdrawn / superseded on their own cadence) and
// tooling examples (vendors sunset / acquire each other) reflect current
// reality rather than the model's training cutoff. The fallback model path
// is intentionally un-grounded — when the primary is 503'ing we optimize
// for "any answer" over "fresh answer". modelVersion on the response is
// suffixed with `+search` when grounding fired.
//
// Caching strategy:
// - NO server-side cache. The client checks Firestore first; only calls this
//   endpoint on cache miss and writes the result back itself.
// - Client-side TTL is 30 days (see coachClient.ts) so newer ISO editions
//   and vendor changes surface within a month of re-visiting a sub-parameter.
// - Keeps this function dependency-free (no Firebase Admin SDK) and cheap.
//
// Security mirrors /api/ai-analyze:
// - Caller must send a Firebase ID token in Authorization: Bearer <token>.
// - Token is verified against Google's public RS256 keys.
// - Only the admin email (ehakun1807@gmail.com) is allowed through to
//   protect the Gemini quota.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { isAllowedEmail } from '../config.ts';

const FIREBASE_PROJECT_ID = 'gen-lang-client-0703668573';

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
// Gemini structured-output schema — the shape the model is forced to return.
// ---------------------------------------------------------------------------

const GATE_ENUM = ['CR', 'PDR', 'CDR', 'TRR', 'PRR', 'MP'];

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        '2-3 concise sentences describing what "good" looks like for this sub-parameter in this industry.'
    },
    rulesOfThumb: {
      type: 'array',
      description: '3-5 crisp, quotable one-liners an engineer should remember.',
      items: { type: 'string' }
    },
    recommendedApproach: {
      type: 'array',
      description:
        '3-5 ordered steps describing the recommended way to deliver this sub-parameter.',
      items: {
        type: 'object',
        properties: {
          step: {
            type: 'string',
            description: 'Short imperative step title, e.g. "Lock the BOM revision"'
          },
          detail: {
            type: 'string',
            description: '1-2 sentences explaining how to execute this step.'
          }
        },
        required: ['step', 'detail']
      }
    },
    commonPitfalls: {
      type: 'array',
      description: '3 common mistakes teams make on this sub-parameter.',
      items: { type: 'string' }
    },
    gateGuidance: {
      type: 'array',
      description:
        'What should be true at each stage gate. Include only gates where this sub-parameter matters.',
      items: {
        type: 'object',
        properties: {
          gate: { type: 'string', enum: GATE_ENUM },
          expectation: {
            type: 'string',
            description: '1-sentence expectation at this gate.'
          }
        },
        required: ['gate', 'expectation']
      }
    },
    referenceStandards: {
      type: 'array',
      description:
        'Relevant industry standards (e.g. ISO 9001, AS9100, IATF 16949, ISO 13485). Only include standards you are confident are relevant. No fabricated clause numbers.',
      items: { type: 'string' }
    },
    toolingExamples: {
      type: 'array',
      description:
        'Example commercial tools or systems used for this sub-parameter in practice (e.g. "Windchill, Arena, Teamcenter" for PLM). 3-6 items.',
      items: { type: 'string' }
    }
  },
  required: [
    'summary',
    'rulesOfThumb',
    'recommendedApproach',
    'commonPitfalls',
    'gateGuidance',
    'referenceStandards',
    'toolingExamples'
  ]
};

// ---------------------------------------------------------------------------
// JSON output instruction used on the grounded path, where Gemini won't let
// us pin the schema via responseSchema. The model is generally reliable at
// following this + we extract robustly on the way back (strip code fences,
// trim prose, etc.) so the occasional quirk doesn't break the card.
// ---------------------------------------------------------------------------

const JSON_OUTPUT_INSTRUCTION = [
  'Output format — return ONLY a single JSON object. No markdown code fences. No prose before or after. No commentary about your search process.',
  '',
  'The object must have EXACTLY these keys and types:',
  '{',
  '  "summary": string,                              // 2-3 sentences on what "good" looks like',
  '  "rulesOfThumb": string[],                       // 3-5 crisp one-liners',
  '  "recommendedApproach": [                        // 3-5 ordered steps',
  '    { "step": string, "detail": string }',
  '  ],',
  '  "commonPitfalls": string[],                     // 3 common mistakes',
  '  "gateGuidance": [                               // only gates where this sub-parameter is actively worked',
  '    { "gate": "CR" | "PDR" | "CDR" | "TRR" | "PRR" | "MP", "expectation": string }',
  '  ],',
  '  "referenceStandards": string[],                 // current, ACTIVE standards only — not withdrawn/superseded editions',
  '  "toolingExamples": string[]                     // 3-6 currently-available commercial tools',
  '}',
  '',
  'Critical: the very first character of your response must be "{" and the very last must be "}". If you return anything else (markdown fences, a preface, source URLs) the client will reject it.'
].join('\n');

// Strip markdown fences / prose and return the best candidate for JSON.parse.
// Order of attempts:
//   1. ```json ... ```  or  ``` ... ```   fenced block — unwrap it.
//   2. First `{` → last matching `}` slice — handles "Here's the JSON: { ... }
//      and here are my sources: ..." style prefixing/suffixing.
//   3. Fall back to the raw text so the caller's try/catch logs the original.
function extractJsonObject(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();

  // Unwrap markdown code fences. Matches ```json\n...\n``` or ```\n...\n```.
  const fence = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fence) {
    s = fence[1].trim();
  }

  // If it already starts with { and ends with }, trust it.
  if (s.startsWith('{') && s.endsWith('}')) return s;

  // Otherwise slice from the first { to the matching final }. We take the
  // LAST closing brace to be forgiving about any trailing "Source: ..." text
  // that doesn't itself contain balanced braces.
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return s.slice(firstBrace, lastBrace + 1);
  }

  return s;
}

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

interface CoachRequest {
  subItemId: string;
  subItemTitle: string;
  subItemDefinition: string;
  subItemTool?: string;
  groupTitle?: string;
  productType: string;
  // Project-level standards the user flagged as applicable (soft preference).
  // We prioritize these in referenceStandards but the model is still allowed
  // to surface other highly-relevant ones it's confident about.
  standards?: string[];
}

function buildPrompt(r: CoachRequest): string {
  const lines: string[] = [];
  lines.push(
    'You are a senior manufacturing NPI (New Product Introduction) advisor with 20 years of experience across hardware industries (Medical, Aerospace, Space, Automotive, Industrial IoT, Consumer Electronics).'
  );
  lines.push('');
  lines.push(
    'You are coaching a hardware engineer on how to optimally deliver a specific sub-parameter of the BridgeOps ramp-readiness framework. Return a JSON object matching the provided schema.'
  );
  lines.push('');
  lines.push(`Sub-parameter title: ${r.subItemTitle}`);
  if (r.groupTitle) lines.push(`Parent group: ${r.groupTitle}`);
  if (r.subItemTool) lines.push(`Referenced tool / methodology: ${r.subItemTool}`);
  lines.push(
    `Definition (what BridgeOps means by this sub-parameter): ${r.subItemDefinition}`
  );
  lines.push(`Product type context: ${r.productType}`);

  // Soft-preference standards steer the tone of the advice toward the user's
  // compliance stack without locking the model out of surfacing other highly-
  // relevant ones it's confident about.
  const selectedStandards = Array.isArray(r.standards)
    ? r.standards.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  if (selectedStandards.length > 0) {
    lines.push(
      `Applicable standards for THIS project (user-selected, prioritize these): ${selectedStandards.join(
        ', '
      )}`
    );
  }

  lines.push('');
  lines.push('Guidance for your answer:');
  lines.push(
    '- Be concrete, practical, and tailored to the product type. No generic platitudes.'
  );
  lines.push(
    '- Tooling examples, regulatory emphasis, and rules of thumb should reflect how top-tier ' +
      r.productType +
      ' companies actually operate.'
  );
  if (selectedStandards.length > 0) {
    lines.push(
      '- When citing standards in referenceStandards or weaving regulatory guidance into rules of thumb / approach / gate expectations, PRIORITIZE the user-selected standards above. List those first. You may still include one or two additional standards if they are highly relevant to this sub-parameter for the product type — but keep the user-selected ones front and center.'
    );
  }
  lines.push(
    '- Only cite industry standards (ISO, AS, IATF, FDA, etc.) if you are confident they are relevant. If unsure, omit. Do NOT fabricate clause numbers.'
  );
  lines.push(
    '- Stage gates used by BridgeOps: CR (Concept Review), PDR (Preliminary Design Review), CDR (Critical Design Review), TRR (Test Readiness Review), PRR (Production Readiness Review), MP (Mass Production). Only include gateGuidance entries for gates where this sub-parameter is actually being worked on.'
  );
  lines.push(
    '- Keep each field tight and scannable. This text will be rendered as a coaching card, not an essay.'
  );
  lines.push('');
  lines.push('Freshness policy (Google Search is enabled as a tool — use it):');
  lines.push(
    '- Regulatory standards change. Before listing a standard in referenceStandards, use Google Search to confirm it is currently ACTIVE and has not been superseded or withdrawn. If a newer edition exists (e.g. ISO 14971:2019 superseding :2007), cite the CURRENT edition. If a standard has been withdrawn or replaced, cite its replacement instead.'
  );
  lines.push(
    '- For toolingExamples, use Google Search to confirm each tool is still commercially available in ' +
      new Date().getFullYear() +
      ' and reflects the current market leaders for ' +
      r.productType +
      '. Avoid discontinued products (e.g. Agile PLM post-Oracle-sunset). Prefer vendors that have been active in the last 12 months.'
  );
  lines.push(
    '- If your internal knowledge and search results disagree, trust the search result. Cite fresh information silently — the final output should be a clean coaching card, not a search transcript.'
  );
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

  // Closed-beta gate: allowlist only. See note in /api/ai-analyze.ts.
  if (!isAllowedEmail(payload.email)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY env var not set');
    return res.status(500).json({ error: 'server not configured' });
  }

  const body = req.body as Partial<CoachRequest> | undefined;
  if (
    !body ||
    !body.subItemId ||
    !body.subItemTitle ||
    !body.subItemDefinition ||
    !body.productType
  ) {
    return res.status(400).json({ error: 'missing request fields' });
  }

  const prompt = buildPrompt(body as CoachRequest);

  // ------------------------------------------------------------------------
  // Gemini call with transient-failure retry + model fallback.
  //
  // Strategy, in order:
  //   1. Primary model (gemini-2.5-flash) with up to 2 extra retries on
  //      transient failures (500ms and 1500ms backoff).
  //   2. If all primary attempts were transient (503/429/5xx/network), fall
  //      back ONCE to a secondary model (gemini-2.5-flash-lite). The lite
  //      model sits in a different capacity pool, so when 2.5-flash is
  //      overloaded the lite variant usually answers immediately.
  //
  // We deliberately do NOT retry 4xx other than 429 — those indicate a
  // configuration problem (bad key, bad schema) that would fail identically
  // on retry and just waste quota.
  //
  // Total worst-case wall time fits inside the 30s maxDuration configured
  // in vercel.json: 3 attempts × ~3s Gemini latency + 2s backoff ≈ 11s,
  // plus ~3s for the fallback call ≈ 14s.
  // ------------------------------------------------------------------------
  const PRIMARY_MODEL = 'gemini-2.5-flash';
  const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
  const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

  // Single-discriminator union ('kind') narrows reliably even with the
  // project's loose tsconfig (no strict / strictNullChecks) — ok/true bools
  // would get widened to `boolean` and break type narrowing.
  type CallResult =
    | { kind: 'ok'; res: Response; model: string }
    | { kind: 'http_error'; statusCode: number; text: string; model: string }
    | { kind: 'network_error'; error: any; model: string };

  async function callModel(
    model: string,
    backoffMs: number[],
    useGrounding: boolean
  ): Promise<CallResult> {
    const maxAttempts = 1 + backoffMs.length;
    let lastHttp: { statusCode: number; text: string } | null = null;
    let lastNetwork: any = null;

    // Gemini forbids combining `tools` (google_search) with
    // `responseMimeType: application/json` + `responseSchema` — the API
    // returns 400 INVALID_ARGUMENT ("Tool use with a response mime type
    // 'application/json' is unsupported"). So the two paths diverge:
    //
    //   - Grounded path (primary): drop the schema config, ask for JSON in
    //     the prompt, extract robustly on the way back. Trades strict
    //     validation for live search of standards/tooling — the right call
    //     given regulations turn over on their own cadence.
    //
    //   - Un-grounded path (fallback): keep the native schema validation.
    //     We're in recovery mode here; any answer is better than a malformed
    //     one.
    const usedPrompt = useGrounding
      ? `${prompt}\n\n${JSON_OUTPUT_INSTRUCTION}`
      : prompt;
    const body: any = {
      contents: [{ role: 'user', parts: [{ text: usedPrompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 4096
      }
    };
    if (useGrounding) {
      body.tools = [{ google_search: {} }];
    } else {
      body.generationConfig.responseMimeType = 'application/json';
      body.generationConfig.responseSchema = RESPONSE_SCHEMA;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
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

  // Primary attempt with retries. Grounded via Google Search so standards
  // and tooling reflect current reality instead of training-cutoff state.
  const primaryResult = await callModel(PRIMARY_MODEL, [500, 1500], true);

  // Decide whether to try the fallback model. Config-level 4xx (bad key,
  // schema mismatch, etc.) normally short-circuits — no point calling the
  // fallback since it would fail identically. Transient 5xx/429 and network
  // errors get a second model as a different capacity pool.
  //
  // Exception: a 400 on the GROUNDED primary is treated as transient. The
  // fallback model is un-grounded (different request shape) so it won't fail
  // for the same reason. This protects us from future Google API changes
  // that might newly reject some aspect of the grounded request — we still
  // return an answer instead of a hard failure.
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
      // Fallback is un-grounded on purpose — flash-lite's grounding support
      // is less predictable, and when we're already in recovery mode from a
      // primary-model outage we optimize for "any answer" over "fresh answer".
      const fallbackResult = await callModel(FALLBACK_MODEL, [], false);
      // Prefer a successful fallback. If both failed, keep the primary's
      // HTTP status when the fallback was merely a network blip — callers
      // debugging quota/key issues want the original signal.
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
    return res.status(502).json({ error: 'ai service unreachable' });
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
    return res.status(502).json({
      error: `ai service error (${result.statusCode})`,
      detail: safeDetail || undefined
    });
  }

  const geminiRes = result.res;
  const usedModel = result.model;
  // Only the primary path is grounded. If we fell back to the lite model the
  // answer is un-grounded, so tag modelVersion accordingly — the admin can
  // then tell freshly-grounded cache entries apart from degraded-fallback
  // ones at a glance when reviewing coachFeedback.
  const wasGrounded = usedModel === PRIMARY_MODEL;
  const data: any = await geminiRes.json();
  const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const finishReason = data?.candidates?.[0]?.finishReason;

  // Light-touch observability for grounding. When Google Search was actually
  // invoked, groundingMetadata surfaces the queries the model ran and the
  // chunks it cited. We don't persist this today (keeps the Firestore doc
  // small), but logging it helps diagnose "why didn't the model update X?"
  // complaints without re-running the request.
  const groundingMetadata = data?.candidates?.[0]?.groundingMetadata;
  if (wasGrounded && groundingMetadata) {
    const queries = Array.isArray(groundingMetadata.webSearchQueries)
      ? groundingMetadata.webSearchQueries
      : [];
    const chunkCount = Array.isArray(groundingMetadata.groundingChunks)
      ? groundingMetadata.groundingChunks.length
      : 0;
    console.log(
      `Coacher grounded: ${queries.length} searches, ${chunkCount} chunks — queries: ${JSON.stringify(
        queries.slice(0, 5)
      )}`
    );
  } else if (wasGrounded) {
    // Grounded call that produced no search activity — the model answered
    // from its own knowledge. Fine for well-known stable sub-parameters.
    console.log('Coacher grounded call: model answered without invoking search');
  }

  if (!textOut) {
    console.error('Empty Gemini response:', JSON.stringify(data).slice(0, 500));
    return res.status(502).json({ error: 'empty ai response' });
  }

  // Robust JSON extraction. When Gemini runs with tools enabled (grounded
  // path) we can't use its native JSON mode, so the model occasionally wraps
  // the payload in ```json``` fences, prefixes it with a sentence, or appends
  // a source list after the closing brace. Rather than fail on any of that,
  // we extract the largest top-level {...} block and try to parse it.
  let parsed: any;
  const extracted = extractJsonObject(textOut);
  try {
    parsed = JSON.parse(extracted);
  } catch (err) {
    console.error(
      'Failed to parse Gemini JSON. finishReason=',
      finishReason,
      'grounded=',
      wasGrounded,
      'raw=',
      textOut.slice(0, 400),
      'extracted=',
      extracted.slice(0, 400)
    );
    if (finishReason === 'MAX_TOKENS') {
      return res
        .status(502)
        .json({ error: 'ai response too long — try again' });
    }
    return res.status(502).json({ error: 'ai returned invalid json' });
  }

  // Defensive normalization so the client can assume fields exist.
  return res.status(200).json({
    summary: String(parsed.summary || ''),
    rulesOfThumb: Array.isArray(parsed.rulesOfThumb) ? parsed.rulesOfThumb : [],
    recommendedApproach: Array.isArray(parsed.recommendedApproach)
      ? parsed.recommendedApproach
      : [],
    commonPitfalls: Array.isArray(parsed.commonPitfalls)
      ? parsed.commonPitfalls
      : [],
    gateGuidance: Array.isArray(parsed.gateGuidance) ? parsed.gateGuidance : [],
    referenceStandards: Array.isArray(parsed.referenceStandards)
      ? parsed.referenceStandards
      : [],
    toolingExamples: Array.isArray(parsed.toolingExamples)
      ? parsed.toolingExamples
      : [],
    generatedAt: Date.now(),
    modelVersion: wasGrounded ? `${usedModel}+search` : usedModel
  });
}
