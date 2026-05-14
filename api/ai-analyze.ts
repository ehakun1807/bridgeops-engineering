// ---------------------------------------------------------------------------
// Vercel serverless function: POST /api/ai-analyze
//
// Takes a project snapshot, asks Gemini 2.5 Flash for a structured readiness
// analysis, and returns { narrative, topActions[], risks[] }.
//
// Security:
// - Caller must send a Firebase ID token in Authorization: Bearer <token>.
// - Token is verified against Google's public RS256 keys (zero deps, Node
//   built-in `crypto`).
// - Only the admin email (ehakun1807@gmail.com) is allowed through, so random
//   traffic can't burn the Gemini free-tier quota.
//
// Runtime: Vercel Node (default, Node 20+, global fetch available).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { isAllowedEmail } from '../config.ts';

const FIREBASE_PROJECT_ID = 'gen-lang-client-0703668573';

const PUBLIC_KEYS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

// Minimal cache of Google's public signing certs. They rotate every few hours;
// we just refetch on every cold start — cheap enough.
let cachedCerts: { fetchedAt: number; certs: Record<string, string> } | null =
  null;
const CERT_TTL_MS = 60 * 60 * 1000; // 1 hour

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
// Gemini structured output schema — what we ask Gemini to return.
// ---------------------------------------------------------------------------

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    narrative: {
      type: 'string',
      description:
        '2-3 paragraph executive summary of current readiness state, in plain English. Reference specific buckets and sub-items.'
    },
    topActions: {
      type: 'array',
      description: 'The 3 most impactful next moves, ranked.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short action title' },
          rationale: { type: 'string', description: '1-2 sentence why' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['title', 'rationale', 'impact']
      }
    },
    risks: {
      type: 'array',
      description: 'Risk flags inferred from notes and low scores.',
      items: {
        type: 'object',
        properties: {
          flag: { type: 'string', description: 'Risk description' },
          source: {
            type: 'string',
            description: 'Which sub-item / note surfaced this'
          },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['flag', 'source', 'severity']
      }
    }
  },
  required: ['narrative', 'topActions', 'risks']
};

interface ProjectItem {
  title: string;
  question?: string;
  tool?: string;
  unit?: string;
  value: number;
  score: number;
  note?: string;
}

interface ProjectGroup {
  title: string;
  subtitle?: string;
  score: number;
  enabledCount?: number;
  totalCount?: number;
  items: ProjectItem[];
}

interface ExcludedGroup {
  title: string;
  excluded: string[];
}

type ProductGate = 'CR' | 'PDR' | 'CDR' | 'TRR' | 'PRR' | 'MP';

const GATE_ORDER: ProductGate[] = ['CR', 'PDR', 'CDR', 'TRR', 'PRR', 'MP'];

const GATE_DESCRIPTIONS: Record<ProductGate, string> = {
  'CR':  'Concept Review — concept + business case validated',
  'PDR': 'Preliminary Design Review — architecture + feasibility',
  'CDR': 'Critical Design Review — design frozen, ready to build',
  'TRR': 'Test Readiness Review — test plans ready to execute',
  'PRR': 'Production Readiness Review — ready for mass production',
  'MP':  'MP — Mass Production / sustaining'
};

interface ProjectInput {
  name: string;
  productType?: string;
  overallScore: number;
  startDate?: string;
  endDate?: string;
  infoStatus?: string;
  generalInfo?: string;
  templateName?: string;
  currentGate?: ProductGate;
  gateTargets?: Partial<Record<ProductGate, string>>;
  // Applicable standards/regulations picked by the user (e.g. ISO 13485,
  // IEC 62304). Used to compliance-weight risk findings and top actions —
  // gaps touching user-declared standards should rank higher.
  standards?: string[];
  groups: ProjectGroup[];
  excludedSummary?: ExcludedGroup[];
}

function buildPrompt(p: ProjectInput): string {
  const lines: string[] = [];
  lines.push(
    'You are a senior hardware ramp-readiness advisor. Analyze the project below and return a structured JSON assessment per the schema.'
  );
  lines.push('');
  lines.push(`Project: ${p.name}${p.productType ? ` (${p.productType})` : ''}`);
  lines.push(`Overall Readiness Score: ${p.overallScore}% (computed over enabled metrics only)`);
  if (p.templateName) lines.push(`Scope Template: ${p.templateName}`);
  if (p.infoStatus) lines.push(`Status: ${p.infoStatus}`);
  if (p.startDate) lines.push(`Start Date: ${p.startDate}`);
  if (p.endDate) lines.push(`End Date: ${p.endDate}`);
  if (p.generalInfo) lines.push(`General Info: ${p.generalInfo}`);

  // Applicable standards — compliance-weight the analysis. Gaps that touch
  // user-declared standards should rank higher in topActions and surface
  // proactively in risks.
  const selectedStandards = Array.isArray(p.standards)
    ? p.standards.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  if (selectedStandards.length > 0) {
    lines.push(
      `Applicable Standards / Regulations: ${selectedStandards.join(', ')}`
    );
  }

  // Stage-gate context — helps the AI reason about which parameters matter
  // most right now and how much schedule pressure the team is under.
  const today = new Date().toISOString().slice(0, 10);
  const hasGateData =
    p.currentGate || (p.gateTargets && Object.keys(p.gateTargets).length > 0);
  if (hasGateData) {
    lines.push('');
    lines.push(`Today's date: ${today}`);
    if (p.currentGate) {
      lines.push(
        `Current Stage Gate: ${p.currentGate} — ${GATE_DESCRIPTIONS[p.currentGate]}`
      );
    }
    if (p.gateTargets && Object.keys(p.gateTargets).length > 0) {
      lines.push('Target Gate Dates:');
      for (const gate of GATE_ORDER) {
        const date = p.gateTargets[gate];
        if (date) {
          const marker = p.currentGate === gate ? ' ← current' : '';
          lines.push(`  ${gate}: ${date}${marker}`);
        }
      }
    }
    // Specifically call out the next upcoming gate so the AI can reason about
    // days-until and whether the team is on/off track.
    if (p.currentGate && p.gateTargets) {
      const currentIdx = GATE_ORDER.indexOf(p.currentGate);
      const nextGate = GATE_ORDER.slice(currentIdx + 1).find(
        (g) => p.gateTargets?.[g]
      );
      if (nextGate) {
        lines.push(
          `Next upcoming gate: ${nextGate} on ${p.gateTargets[nextGate]}.`
        );
      }
    }
  }

  // Make scope exclusions explicit so the AI doesn't flag "missing evidence"
  // on metrics the user deliberately marked N/A.
  if (p.excludedSummary && p.excludedSummary.length > 0) {
    lines.push('');
    lines.push(
      'SCOPE NOTE: The following metrics are explicitly OUT OF SCOPE for this project. ' +
        'Do NOT recommend actions or flag risks related to these — treat them as non-applicable.'
    );
    for (const g of p.excludedSummary) {
      lines.push(`- ${g.title}: ${g.excluded.join(', ')}`);
    }
  }

  lines.push('');
  lines.push('Parameter Groups (enabled metrics only):');

  for (const g of p.groups) {
    lines.push('');
    const countTag =
      g.enabledCount != null && g.totalCount != null && g.enabledCount < g.totalCount
        ? ` [${g.enabledCount}/${g.totalCount} enabled]`
        : '';
    lines.push(`## ${g.title} — ${g.score}%${countTag}`);
    if (g.subtitle) lines.push(g.subtitle);
    for (const item of g.items) {
      const val =
        item.unit && Number.isFinite(item.value)
          ? ` (value: ${item.value} ${item.unit})`
          : '';
      const note = item.note ? ` | Note: "${item.note}"` : '';
      lines.push(`- ${item.title}: ${item.score}%${val}${note}`);
      if (item.question) lines.push(`    measures: ${item.question}`);
    }
  }

  lines.push('');
  lines.push('Your job (be concise — stay within the token budget):');
  lines.push(
    '1. narrative — 2 short paragraphs max (~150 words total). Call out strongest and weakest buckets, reference specific sub-items, and note schedule pressure if dates imply it. If a current gate is set, frame the narrative around that gate (what it takes to pass, what is blocking). If a next gate target date is set, explicitly mention days-until and whether readiness suggests on-track / at-risk / slipping.'
  );
  lines.push(
    '2. topActions — exactly 3 moves, ranked by (score gap × criticality × feasibility) AND weighted by what matters most at the current gate. Design sub-items matter most at PDR/CDR; Manufacturing/Supply/Quality matter most at TRR/PRR. Each: short title, 1-sentence rationale referencing specific metrics by name. If schedule pressure is high, bias toward feasible moves with fast impact.'
  );
  lines.push(
    '3. risks — up to 5 risks max, inferred from notes, low scores, and gate timing. Each: short flag, short source reference. Flag gate-slip risk explicitly if a gate target is inconsistent with current readiness.'
  );
  if (selectedStandards.length > 0) {
    lines.push('');
    lines.push(
      'Compliance weighting: When assessing topActions and risks, give additional weight to gaps that would create a non-conformance or audit finding against the Applicable Standards listed above. Where a low-scoring item has a direct tie-in (e.g. Design Controls ↔ ISO 13485 §7.3, Software Lifecycle ↔ IEC 62304, Functional Safety ↔ ISO 26262), call out the standard by name in the rationale or flag. Do NOT cite specific clause numbers unless you are highly confident; stick to the standard identifier.'
    );
  }
  lines.push('');
  lines.push(
    'Be concrete and specific. Avoid filler and generic advice. Anchor everything to the data provided. Keep sentences tight.'
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

  // Closed-beta gate: allowlist is the only check. email_verified is
  // intentionally NOT required so manually-provisioned Console users with
  // fake email domains (e.g. beta1@bridgeops.local) can sign in. The
  // allowlist itself is the security boundary — re-add the email_verified
  // check before opening public sign-up.
  if (!isAllowedEmail(payload.email)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY env var not set');
    return res.status(500).json({ error: 'server not configured' });
  }

  const project = req.body?.project as ProjectInput | undefined;
  if (!project || !project.name || !Array.isArray(project.groups)) {
    return res.status(400).json({ error: 'missing project data' });
  }

  // Custom-template projects start with every metric disabled. The client's
  // buildSnapshot filters out groups with zero enabled items, which leaves an
  // empty groups[] for fresh Custom projects. Sending that to Gemini produces
  // a degenerate prompt with no data — refuse here with a clear message
  // instead of letting Gemini reject it as a generic 502.
  if (project.groups.length === 0) {
    return res.status(400).json({
      error: 'no metrics in scope — enable at least one metric on the General Info tab before running AI Analysis'
    });
  }

  const prompt = buildPrompt(project);

  // ------------------------------------------------------------------------
  // Gemini call with transient-failure retry + model fallback. Mirrors the
  // pattern in /api/ai-coach, /api/find-equivalent, /api/quote-compare.
  //
  // Strategy:
  //   1. Primary model (gemini-2.5-flash) with 2 backoff retries (500ms,
  //      1500ms) on transient failures (503/429/5xx/network).
  //   2. If primary still failing on transient errors, fall back ONCE to
  //      gemini-2.5-flash-lite. Different capacity pool — typically up
  //      when the primary is overloaded.
  //
  // 4xx other than 429 are NOT retried — they indicate a configuration
  // problem that would fail identically on retry.
  // ------------------------------------------------------------------------
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
        maxOutputTokens: 8192
      }
    };

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
    // 503 specifically = model overloaded. Surface a friendlier message so
    // the user knows it's transient and worth retrying in a moment.
    const friendly =
      result.statusCode === 503
        ? 'AI service is overloaded right now — please try again in a minute'
        : `ai service error (${result.statusCode})`;
    return res.status(502).json({
      error: friendly,
      ...(safeDetail ? { detail: safeDetail } : {})
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
      return res
        .status(502)
        .json({ error: 'ai response too long — try regenerating' });
    }
    return res.status(502).json({ error: 'ai returned invalid json' });
  }

  return res.status(200).json({
    narrative: String(parsed.narrative || ''),
    topActions: Array.isArray(parsed.topActions) ? parsed.topActions : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    generatedAt: Date.now()
  });
}
