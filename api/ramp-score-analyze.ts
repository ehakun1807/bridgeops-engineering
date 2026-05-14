// ---------------------------------------------------------------------------
// Vercel serverless function: POST /api/ramp-score-analyze
//
// Public (no-auth) endpoint that powers the free RampScore Snapshot on
// /#/ramp-score. Replaces the previous client-side Gemini call that leaked
// GEMINI_API_KEY in the production JS bundle.
//
// Design notes:
//   - No Firebase auth — RampScore is a public lead-gen tool. Random visitors
//     are expected to hit it.
//   - Server owns the prompt template. The client only sends structured data
//     (company name, product type, standards, parameter snapshot, weighted
//     score). This stops prompt-injection from a hostile caller.
//   - Light per-IP rate limit (5 / 10 min) implemented in-memory. Imperfect
//     because Vercel cold-starts wipe the counter, but it stops trivial loops
//     without needing Upstash/Redis. Sufficient for a public lead-gen tool.
//   - Body size caps on every string field — prevents prompt-bloat DoS.
//   - Same retry + fallback ladder used in /api/ai-analyze.
//
// Runtime: Vercel Node (default).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// In-memory rate limit (per Vercel instance).
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_MAX_CALLS = 5;              // per window per IP
const rateBuckets = new Map<string, number[]>();

function rateCheck(ip: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const hits = (rateBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX_CALLS) {
    const oldest = hits[0];
    return { ok: false, retryAfterSec: Math.ceil((RATE_WINDOW_MS - (now - oldest)) / 1000) };
  }
  hits.push(now);
  rateBuckets.set(ip, hits);
  // Opportunistic GC so the map doesn't grow forever on a long-lived instance.
  if (rateBuckets.size > 1000) {
    for (const [k, v] of rateBuckets) {
      const fresh = v.filter((t) => now - t < RATE_WINDOW_MS);
      if (fresh.length === 0) rateBuckets.delete(k);
      else rateBuckets.set(k, fresh);
    }
  }
  return { ok: true, retryAfterSec: 0 };
}

function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const xff = headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  if (typeof raw === 'string' && raw.length > 0) return raw.split(',')[0].trim();
  const xr = headers['x-real-ip'];
  if (typeof xr === 'string') return xr;
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Input shape — structured data only, no raw prompts from the client.
// ---------------------------------------------------------------------------

// Hard caps to prevent prompt-bloat DoS. Generous but bounded.
const MAX_NAME = 200;
const MAX_PRODUCT_TYPE = 100;
const MAX_STANDARD = 80;
const MAX_STANDARDS = 30;
const MAX_PARAM_LINE = 4000; // each section's concatenated string

interface ReqBody {
  companyName?: unknown;
  productType?: unknown;
  standards?: unknown;
  weightedScore?: unknown;
  paramSnapshot?: {
    context?: unknown;
    operational?: unknown;
    supply?: unknown;
  };
}

interface CleanInput {
  companyName: string;
  productType: string;
  standards: string[];
  weightedScore: number;
  paramSnapshot: {
    context: string;
    operational: string;
    supply: string;
  };
}

function sanitize(raw: ReqBody): CleanInput | { error: string } {
  const companyName = String(raw.companyName ?? '').trim().slice(0, MAX_NAME);
  if (!companyName) return { error: 'missing companyName' };

  const productType = String(raw.productType ?? '').trim().slice(0, MAX_PRODUCT_TYPE) || 'Unspecified';

  const standardsRaw = Array.isArray(raw.standards) ? raw.standards : [];
  const standards = standardsRaw
    .map((s) => String(s ?? '').trim().slice(0, MAX_STANDARD))
    .filter(Boolean)
    .slice(0, MAX_STANDARDS);

  const weightedScore = Math.max(0, Math.min(100, Number(raw.weightedScore) || 0));

  const ps = raw.paramSnapshot || {};
  const paramSnapshot = {
    context: String(ps.context ?? '').slice(0, MAX_PARAM_LINE),
    operational: String(ps.operational ?? '').slice(0, MAX_PARAM_LINE),
    supply: String(ps.supply ?? '').slice(0, MAX_PARAM_LINE),
  };

  return {
    companyName,
    productType,
    standards,
    weightedScore,
    paramSnapshot,
  };
}

// ---------------------------------------------------------------------------
// Prompt template — mirrors the prompt that lived inside RampScoreTool.tsx
// before this endpoint existed. Keep the structure stable; the result-rendering
// code in RampScoreTool relies on the { riskLevel, risks, recommendations,
// analysis, kpis } shape.
// ---------------------------------------------------------------------------

function buildPrompt(p: CleanInput): string {
  const standardsLine = p.standards.length > 0
    ? `Applicable Standards / Regulations: ${p.standards.join(', ')}. Weigh compliance-readiness against each of these standards when assessing risk and recommendations.`
    : `Applicable Standards / Regulations: None selected. Flag the absence of explicit compliance targets as a contributing risk factor.`;

  return `You are a senior NPI / operations engineering advisor producing a written audit for a hardware-startup executive. The tone is authoritative, concrete, and grounded in industry practice (IATF 16949, ISO 13485, AS9100, IEC 61508 etc. where relevant).

Context — assess manufacturing ramp readiness for ${p.companyName} (${p.productType}).
Weighted Readiness Score: ${p.weightedScore}%
Product Context: ${p.paramSnapshot.context}
Operational Readiness: ${p.paramSnapshot.operational}
Volume & Supply Base: ${p.paramSnapshot.supply}
${standardsLine}

Produce the following:

(1) riskLevel — one of LOW / MEDIUM / HIGH.

(2) risks — exactly 3 items, each with:
    - title: a short risk headline (max 10 words), referencing a concrete value from the data (e.g. "Only 10 suppliers — concentration exposure on critical BOM").
    - detail: 3-5 sentences explaining why this risk matters for *this* company, the likely operational impact during ramp (line-down events, yield loss, schedule slip with rough magnitude), and the specific parameter / standard that makes it a risk. Reference the selected standards where relevant.

(3) recommendations — exactly 3 items, each with:
    - title: a short actionable headline (max 10 words) using an imperative verb (e.g. "Qualify dual-source alternates for top 10 critical components").
    - detail: 3-5 sentences giving (a) the concrete first step, (b) expected timeframe / effort, (c) the metric or standard to verify completion, (d) expected risk reduction. Tie each recommendation back to one of the risks above.

(4) analysis — 2-3 sentence executive summary referencing the most material weaknesses and the likely ramp-readiness verdict.`;
}

// ---------------------------------------------------------------------------
// Gemini structured-output schema — raw JSON-schema form (not the @google/genai
// Type enum). Matches the shape RampScoreTool already renders.
// ---------------------------------------------------------------------------

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    riskLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['title', 'detail'],
      },
    },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['title', 'detail'],
      },
    },
    analysis: { type: 'string' },
    kpis: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          metric: { type: 'string' },
          target: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  },
  required: ['riskLevel', 'risks', 'recommendations', 'analysis'],
};

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

  // Rate limit by IP. Best-effort — Vercel cold-starts reset the counter.
  const ip = clientIp(req.headers);
  const rl = rateCheck(ip);
  if (!rl.ok) {
    return res.status(429).json({
      error: `too many requests — try again in ${rl.retryAfterSec}s`,
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY env var not set');
    return res.status(500).json({ error: 'server not configured' });
  }

  const cleaned = sanitize(req.body || {});
  if ('error' in cleaned) {
    return res.status(400).json({ error: cleaned.error });
  }

  const prompt = buildPrompt(cleaned);

  // Same retry + fallback ladder as /api/ai-analyze. Primary 2.5-flash, then
  // one fallback to 2.5-flash-lite on transient failures.
  const PRIMARY_MODEL = 'gemini-2.5-flash';
  const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
  const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

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
        temperature: 0.6,
        maxOutputTokens: 4096,
      },
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
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

    if (lastHttp) {
      return { kind: 'http_error', model, statusCode: lastHttp.statusCode, text: lastHttp.text };
    }
    return { kind: 'network_error', model, error: lastNetwork };
  }

  const primaryResult = await callModel(PRIMARY_MODEL, [500, 1500]);

  let result: CallResult = primaryResult;
  if (primaryResult.kind !== 'ok') {
    const primaryTransient =
      primaryResult.kind === 'network_error' ||
      (primaryResult.kind === 'http_error' && RETRY_STATUSES.has(primaryResult.statusCode));
    if (primaryTransient) {
      console.warn(
        `Primary model ${PRIMARY_MODEL} exhausted retries, falling back to ${FALLBACK_MODEL}`
      );
      const fallbackResult = await callModel(FALLBACK_MODEL, []);
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
    console.error(`Gemini fetch failed after retries (${result.model}):`, result.error);
    return res.status(502).json({ error: 'ai service unreachable' });
  }
  if (result.kind === 'http_error') {
    console.error(`Gemini error after retries (${result.model}):`, result.statusCode, result.text);
    const safeDetail = (result.text || '')
      .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[key]')
      .slice(0, 300);
    const friendly =
      result.statusCode === 503
        ? 'AI service is overloaded right now — please try again in a minute'
        : `ai service error (${result.statusCode})`;
    return res.status(502).json({
      error: friendly,
      ...(safeDetail ? { detail: safeDetail } : {}),
    });
  }

  const geminiRes = result.res;
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
      return res.status(502).json({ error: 'ai response too long — try regenerating' });
    }
    return res.status(502).json({ error: 'ai returned invalid json' });
  }

  // Normalize + clamp before returning. The client expects this exact shape.
  const norm = (arr: any) =>
    Array.isArray(arr)
      ? arr
          .filter((x: any) => x && typeof x === 'object')
          .map((x: any) => ({
            title: String(x.title || '').slice(0, 200),
            detail: String(x.detail || '').slice(0, 2000),
          }))
          .slice(0, 5)
      : [];

  return res.status(200).json({
    riskLevel:
      parsed.riskLevel === 'LOW' || parsed.riskLevel === 'MEDIUM' || parsed.riskLevel === 'HIGH'
        ? parsed.riskLevel
        : cleaned.weightedScore > 80
          ? 'LOW'
          : cleaned.weightedScore > 60
            ? 'MEDIUM'
            : 'HIGH',
    risks: norm(parsed.risks),
    recommendations: norm(parsed.recommendations),
    analysis: String(parsed.analysis || '').slice(0, 2000),
    kpis: Array.isArray(parsed.kpis)
      ? parsed.kpis
          .filter((k: any) => k && typeof k === 'object')
          .map((k: any) => ({
            category: String(k.category || '').slice(0, 100),
            metric: String(k.metric || '').slice(0, 200),
            target: String(k.target || '').slice(0, 100),
            description: String(k.description || '').slice(0, 500),
          }))
          .slice(0, 10)
      : [],
    generatedAt: Date.now(),
  });
}
