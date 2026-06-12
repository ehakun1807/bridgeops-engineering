// ---------------------------------------------------------------------------
// Vercel serverless function: POST /api/bom-impact-analyze
//
// Given a BOM diff (the output of bomDiff.diffBoms, computed client-side)
// plus project context (gate, standards, enabled RAMP items, optional
// PFMEA / takt / process-map summaries), asks Gemini for a structured
// impact analysis: which readiness items are affected, what new risks
// are introduced, and the top 3 next actions.
//
// We send the DIFF, not the full BOMs, to keep token cost bounded — a
// typical rev-over-rev BOM change is 5-50 lines even when the BOMs are
// 2000 rows. The handler enforces an upper bound on the diff payload so
// pathological inputs (e.g. baseline empty → 2000 added lines) don't
// blow the token budget. Lines beyond the cap are summarized as counts.
//
// Security: same Firebase ID-token + closed-beta allowlist gate, same
// retry+fallback ladder, same AIza key scrub as /api/ai-analyze and the
// other AI handlers. Inlined allowlist for the ERR_MODULE_NOT_FOUND
// reasons documented in the May 14 session log.
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
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as FirebasePayload;

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
// Response schema (structured-output)
// ---------------------------------------------------------------------------

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    narrative: {
      type: 'string',
      description:
        '2-3 short paragraphs framing the magnitude and character of this BOM change in the project context. Reference the gate (if set) and supplier-swap / cost / qty patterns. ≤180 words total.'
    },
    affectedRampItems: {
      type: 'array',
      description:
        'Readiness items materially impacted by this BOM change. Use rampItemId values from the provided enabled-items list verbatim. ≤6 items.',
      items: {
        type: 'object',
        properties: {
          rampItemId: { type: 'string', description: 'Exact id from the enabled items list provided in the prompt.' },
          rampItemTitle: { type: 'string', description: 'Echo the title for readability.' },
          rationale: { type: 'string', description: '1-2 short sentences tying the change to this item.' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['rampItemId', 'rampItemTitle', 'rationale', 'severity']
      }
    },
    newRisks: {
      type: 'array',
      description: 'Net-new risks introduced by this BOM change. ≤5.',
      items: {
        type: 'object',
        properties: {
          flag: { type: 'string', description: 'Short risk title' },
          source: { type: 'string', description: 'Which line / change kind drove this' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['flag', 'source', 'severity']
      }
    },
    topActions: {
      type: 'array',
      description: 'Up to 3 most impactful next moves. Bias toward feasible re-qualification / sourcing / verification steps.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          rationale: { type: 'string' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['title', 'rationale', 'impact']
      }
    }
  },
  required: ['narrative', 'affectedRampItems', 'newRisks', 'topActions']
};

// ---------------------------------------------------------------------------
// Input shapes (validated lightly — we don't try to type-narrow every leaf)
// ---------------------------------------------------------------------------

type ProductGate = 'CR' | 'PDR' | 'CDR' | 'TRR' | 'PRR' | 'MP';

const GATE_DESCRIPTIONS: Record<ProductGate, string> = {
  'CR':  'Concept Review',
  'PDR': 'Preliminary Design Review',
  'CDR': 'Critical Design Review — design freeze',
  'TRR': 'Test Readiness Review',
  'PRR': 'Production Readiness Review',
  'MP':  'Mass Production'
};

interface DiffLinePreview {
  // The "after" identifier (or "before" if removed)
  bomLevel?: number;
  internalPn?: string;
  mpn?: string;
  manufacturer?: string;
  description?: string;
  refDes?: string;
  qty?: number;
  unitCost?: number;
  /** Revision / revision letter of the part or document (e.g. "A", "B", "02"). */
  rev?: string;
  /** Part type / item category from the originating PLM (e.g. "Label", "Sub Assy", "MFG", "PCBA"). */
  partType?: string;
}

interface ChangedLinePreview extends DiffLinePreview {
  // The "before" snapshot so the AI can see what changed
  before?: DiffLinePreview;
  kinds: string[];
}

interface DiffSummaryIn {
  totalBefore: number;
  totalAfter: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  qtyDelta: number;
  costDelta: number;
  supplierSwapCount: number;
}

interface EnabledItem {
  id: string;
  title: string;
  groupTitle?: string;
}

interface ImpactInput {
  projectName: string;
  productType?: string;
  currentGate?: ProductGate;
  gateTargets?: Partial<Record<ProductGate, string>>;
  standards?: string[];
  templateName?: string;
  baselineLabel?: string;     // e.g. "Rev A" or upload date
  currentLabel?: string;      // e.g. "Rev B"
  /** Effective date of the new revision (epoch ms). May differ from upload
   *  date — user can backdate to the ECO-effective date. */
  effectiveDateMs?: number;
  /** First-class "why" — ECO #, supplier rationale, etc. Weights AI's framing. */
  reasonForChange?: string;
  /** True if the BOM is multi-level (bomLevel present on lines). Tells the
   *  AI that re-parenting events are meaningful in the diff. */
  isMultiLevel?: boolean;
  diffSummary: DiffSummaryIn;
  added: DiffLinePreview[];
  removed: DiffLinePreview[];
  changed: ChangedLinePreview[];
  enabledItems: EnabledItem[];
  // Optional context the AI can use to call out interactions with other tools
  pfmeaTopRisk?: string;
  taktSummary?: string;
  hasProcessMap?: boolean;
}

// Cap how many lines we list in the prompt. Beyond this we summarize.
const MAX_LINES_LISTED = 40;

function lineRef(l: DiffLinePreview): string {
  // Best identifier in compact form. Prefix with "[PartType]" when available
  // so the AI can classify the part before attributing impact.
  const parts: string[] = [];
  if (l.partType) parts.push(`[${l.partType}]`);
  if (l.bomLevel != null) parts.push(`L${l.bomLevel}`);
  if (l.internalPn) parts.push(l.internalPn);
  if (l.rev) parts.push(`Rev ${l.rev}`);
  if (l.mpn) parts.push(`MPN ${l.mpn}`);
  if (l.manufacturer && !parts.some((p) => p.includes('MPN'))) parts.push(l.manufacturer);
  if (l.refDes && parts.filter((p) => !p.startsWith('[') && !p.startsWith('L')).length === 0) parts.push(`@${l.refDes}`);
  if (l.description && parts.filter((p) => !p.startsWith('[') && !p.startsWith('L')).length === 0) parts.push(l.description.slice(0, 40));
  return parts.length ? parts.join(' / ') : '(unidentified)';
}

function buildPrompt(p: ImpactInput): string {
  const lines: string[] = [];
  lines.push(
    'You are a senior hardware ramp-readiness advisor. A BOM revision has just been uploaded. Assess the *delta* between the prior BOM and the new one in the context of the project below. Return a structured JSON impact analysis per the schema.'
  );
  lines.push('');
  lines.push(`Project: ${p.projectName}${p.productType ? ` (${p.productType})` : ''}`);
  if (p.templateName) lines.push(`Scope Template: ${p.templateName}`);
  if (p.currentGate) {
    lines.push(`Current Gate: ${p.currentGate} — ${GATE_DESCRIPTIONS[p.currentGate]}`);
  }
  if (p.gateTargets) {
    const targets = Object.entries(p.gateTargets)
      .filter(([, date]) => Boolean(date))
      .map(([g, date]) => `${g}: ${date}`);
    if (targets.length) lines.push(`Gate Targets: ${targets.join(' · ')}`);
  }
  if (p.standards && p.standards.length > 0) {
    lines.push(`Applicable Standards / Regulations: ${p.standards.join(', ')}`);
    lines.push(
      'When a BOM change would create a non-conformance or trigger re-qualification against any of the above standards, call out the standard by name in the rationale / risk flag. Do not cite specific clause numbers unless you are highly confident.'
    );
  }
  if (p.pfmeaTopRisk) lines.push(`Open PFMEA top risk: ${p.pfmeaTopRisk}`);
  if (p.taktSummary) lines.push(`Takt / capacity context: ${p.taktSummary}`);
  if (p.hasProcessMap) lines.push('A saved Process Map exists for this project — flag if a changed line is likely referenced in process steps.');

  lines.push('');
  lines.push(
    `BOM Revision: ${p.baselineLabel || 'previous'} → ${p.currentLabel || 'latest'}`
  );
  if (p.effectiveDateMs) {
    const eff = new Date(p.effectiveDateMs).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const tag = eff < today ? ' (backdated)' : eff > today ? ' (future-dated)' : '';
    lines.push(`Effective date: ${eff}${tag}`);
  }
  if (p.reasonForChange && p.reasonForChange.trim()) {
    // Cap to keep prompt bounded; user-provided text could be long.
    const r = p.reasonForChange.slice(0, 500).trim();
    lines.push(`Reason for change (per the engineer who uploaded): "${r}"`);
    lines.push(
      'Weight your analysis against this reason — if the reason cites a non-conformance / FUSA / regulatory driver, lean into compliance risk; if it cites cost or lead-time, lean into supplier-readiness and qualification re-spin.'
    );
  }
  if (p.isMultiLevel) {
    lines.push(
      'NOTE: This is a multi-level (indented) BOM. The "Lk" prefix on each line is the indent level (1 = top assembly, 2 = sub-assembly, etc.). A change of `level` kind means the part was re-parented between assemblies — flag any consequent test-coverage / fixture / process-step implications.'
    );
  }
  const s = p.diffSummary;
  lines.push(
    `Summary: total ${s.totalBefore} → ${s.totalAfter} lines · added ${s.addedCount} · removed ${s.removedCount} · changed ${s.changedCount} · supplier swaps ${s.supplierSwapCount} · qty Δ ${s.qtyDelta >= 0 ? '+' : ''}${s.qtyDelta} · cost Δ ${s.costDelta >= 0 ? '+$' : '-$'}${Math.abs(s.costDelta).toFixed(2)} (per assembly)`
  );

  // Added
  if (p.added.length > 0) {
    lines.push('');
    lines.push(`Added lines (${p.added.length}):`);
    const sample = p.added.slice(0, MAX_LINES_LISTED);
    for (const l of sample) {
      const q = l.qty != null ? ` qty=${l.qty}` : '';
      const c = l.unitCost != null ? ` @ $${l.unitCost}` : '';
      lines.push(`+ ${lineRef(l)}${q}${c}`);
    }
    if (p.added.length > MAX_LINES_LISTED) {
      lines.push(`... and ${p.added.length - MAX_LINES_LISTED} more added`);
    }
  }

  // Removed
  if (p.removed.length > 0) {
    lines.push('');
    lines.push(`Removed lines (${p.removed.length}):`);
    const sample = p.removed.slice(0, MAX_LINES_LISTED);
    for (const l of sample) {
      lines.push(`- ${lineRef(l)}`);
    }
    if (p.removed.length > MAX_LINES_LISTED) {
      lines.push(`... and ${p.removed.length - MAX_LINES_LISTED} more removed`);
    }
  }

  // Changed (most informative — show the before→after where it fits)
  if (p.changed.length > 0) {
    lines.push('');
    lines.push(`Changed lines (${p.changed.length}):`);
    const sample = p.changed.slice(0, MAX_LINES_LISTED);
    for (const c of sample) {
      const beforeRef = c.before ? lineRef(c.before) : '?';
      const afterRef = lineRef(c);
      const kinds = c.kinds && c.kinds.length ? ` [${c.kinds.join(', ')}]` : '';
      lines.push(`~ ${beforeRef} → ${afterRef}${kinds}`);
    }
    if (p.changed.length > MAX_LINES_LISTED) {
      lines.push(`... and ${p.changed.length - MAX_LINES_LISTED} more changed`);
    }
  }

  // Enabled RAMP items — IDs are what the AI must use in affectedRampItems.
  lines.push('');
  lines.push('Enabled readiness items (use these exact IDs in affectedRampItems):');
  for (const it of p.enabledItems) {
    const groupTag = it.groupTitle ? ` [${it.groupTitle}]` : '';
    lines.push(`- ${it.id}: ${it.title}${groupTag}`);
  }

  lines.push('');
  lines.push('## Part Classification — apply BEFORE attributing readiness impact');
  lines.push(
    'Each changed line is tagged with [PartType] when available. Use it to classify the part FIRST, then determine what impact is actually plausible. Wrong attributions are worse than no attribution.'
  );
  lines.push('Classification rules:');
  lines.push('- [Label] / [Artwork] / [Packaging] / [Label Assy]: cosmetic/regulatory-marking parts. Impact is LIMITED TO labeling compliance (UDI, CE, FDA marking) and documentation updates. Do NOT flag test coverage, test fixtures, firmware, mechanical tooling, or manufacturing capacity — labels have zero bearing on those.');
  lines.push('- [Document] / [MFG] (work instruction, routing, SOP): affects process documentation and traceability metrics only. Does NOT affect hardware design, firmware, or supplier readiness unless the content change introduces a process step requiring new tooling or qualification.');
  lines.push('- [PCBA] / [PCB] / [Electronic] / [IC] / [Component]: may affect firmware, test coverage, EMC, supplier readiness, design freeze — assess carefully.');
  lines.push('- [Sub Assy] / [Assy] / [Mechanical]: may affect DFM, tooling, fixture, and manufacturing metrics — scope to function served.');
  lines.push('- [Fastener] / [Hardware] / [Standard]: generally low risk; flag only if the supplier swap or qty delta is large enough to threaten supply.');
  lines.push('- Unknown type or no [PartType] tag: use description and MPN to infer. When uncertain, err conservative — do not invent impacts.');
  lines.push('');
  lines.push('## Revision (Rev) changes — interpretation rules');
  lines.push('When a change includes a `rev` kind, a part or document revision bumped without the part identifier changing. Apply the following:');
  lines.push('- Document / MFG / SOP rev bump → traceability and process-doc currency risk. Check whether the new revision is reflected in the DHF / DMR and if any approval signatures are now stale.');
  lines.push('- Mechanical / Custom part rev bump → likely a fit/form/function modification. Flag DFM, fixture, and tooling implications. If post-CDR, flag design-freeze risk.');
  lines.push('- PCBA / Electronic component rev bump → may indicate an approved vendor list (AVL) change or silicon stepping. Flag qualification re-spin and test coverage.');
  lines.push('- Label / Artwork rev bump → artwork review and regulatory marking compliance only. Do NOT flag test fixtures or firmware.');
  lines.push('');
  lines.push('Your analysis must be concrete and tied to this specific delta:');
  lines.push(
    '1. narrative — 2 short paragraphs. Open with the magnitude of the change. Call out the highest-leverage patterns (supplier swaps, regulatory-relevant part swaps, large qty deltas). If cosmetic/label changes dominate, say so explicitly. If a gate is set, frame timing implications. ≤180 words.'
  );
  lines.push(
    '2. affectedRampItems — only items GENUINELY impacted after applying the classification rules above. A label swap does NOT affect "Production Test Coverage" or "Test Fixture Readiness". A supplier swap on a functional component DOES affect "Supplier Readiness". Use IDs verbatim. ≤6 items.'
  );
  lines.push(
    '3. newRisks — risks actually introduced by this delta (applying classification). ≤5.'
  );
  lines.push(
    '4. topActions — up to 3 concrete next moves. Match the action to the actual part type — label changes → update artwork review checklist, not fixture regression.'
  );
  lines.push('');
  lines.push('Be terse. No filler. Anchor every claim to a specific line + its part type.');

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

  const input = req.body as ImpactInput | undefined;
  if (!input || !input.projectName || !input.diffSummary) {
    return res.status(400).json({ error: 'missing input' });
  }
  if (!Array.isArray(input.added) || !Array.isArray(input.removed) || !Array.isArray(input.changed)) {
    return res.status(400).json({ error: 'malformed diff arrays' });
  }
  if (!Array.isArray(input.enabledItems) || input.enabledItems.length === 0) {
    return res.status(400).json({
      error: 'no enabled readiness items in scope — open project scope and enable at least one metric before requesting BOM impact analysis'
    });
  }
  if (input.added.length === 0 && input.removed.length === 0 && input.changed.length === 0) {
    return res.status(400).json({ error: 'no BOM changes detected — nothing to analyze' });
  }

  const prompt = buildPrompt(input);

  // Gemini call with retry+fallback — same ladder as the other AI handlers.
  const PRIMARY_MODEL = 'gemini-2.5-flash';
  const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
  const RETRY_STATUSES = new Set([429, 500, 502, 503]); // 504 excluded: retrying a timeout burns remaining budget

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
        temperature: 0.5,
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

    if (lastHttp) return { kind: 'http_error', model, statusCode: lastHttp.statusCode, text: lastHttp.text };
    return { kind: 'network_error', model, error: lastNetwork };
  }

  const primaryResult = await callModel(PRIMARY_MODEL, [500, 1500]);

  let result: CallResult = primaryResult;
  if (primaryResult.kind !== 'ok') {
    const primaryTransient =
      primaryResult.kind === 'network_error' ||
      (primaryResult.kind === 'http_error' && RETRY_STATUSES.has(primaryResult.statusCode));
    if (primaryTransient) {
      console.warn(`Primary model ${PRIMARY_MODEL} exhausted retries, falling back to ${FALLBACK_MODEL}`);
      const fallbackResult = await callModel(FALLBACK_MODEL, []);
      if (fallbackResult.kind === 'ok') {
        result = fallbackResult;
      } else if (fallbackResult.kind === 'http_error' && primaryResult.kind === 'network_error') {
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
    const safeDetail = (result.text || '').replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[key]').slice(0, 300);
    const friendly =
      result.statusCode === 503
        ? 'AI service is overloaded right now — please try again in a minute'
        : `ai service error (${result.statusCode})`;
    return res.status(502).json({ error: friendly, ...(safeDetail ? { detail: safeDetail } : {}) });
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
    console.error('Failed to parse Gemini JSON. finishReason=', finishReason, 'text=', textOut.slice(0, 800));
    if (finishReason === 'MAX_TOKENS') {
      return res.status(502).json({ error: 'ai response too long — try regenerating' });
    }
    return res.status(502).json({ error: 'ai returned invalid json' });
  }

  return res.status(200).json({
    narrative: String(parsed.narrative || ''),
    affectedRampItems: Array.isArray(parsed.affectedRampItems) ? parsed.affectedRampItems : [],
    newRisks: Array.isArray(parsed.newRisks) ? parsed.newRisks : [],
    topActions: Array.isArray(parsed.topActions) ? parsed.topActions : [],
    generatedAt: Date.now()
  });
}
