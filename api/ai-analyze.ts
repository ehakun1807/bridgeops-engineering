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

const FIREBASE_PROJECT_ID = 'gen-lang-client-0703668573';

// Closed-beta allowlist — KEEP IN SYNC with config.ts (ALLOWED_EMAILS)
// and firestore.rules (isAdmin's email-in list). Inlined here rather than
// imported because Vercel's serverless bundler preserves the `.ts`
// extension literally in the deployed JS, causing ERR_MODULE_NOT_FOUND
// at runtime when the function tries to resolve a cross-file TS import.
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
    statusSnapshot: {
      type: 'string',
      description:
        'One-sentence YTD verdict. Format: "<Project> is <on track / at risk / slipping> for <next gate> — <single sharpest observation>." Max 25 words.'
    },
    narrative: {
      type: 'string',
      description:
        '3 short paragraphs: (1) Overall readiness status referencing RAMP score + gate position. (2) Key signals from live tools — PFMEA risks, BOM changes, meeting action items, takt capacity. (3) Schedule outlook and top concern. ~200 words total.'
    },
    topActions: {
      type: 'array',
      description: 'The 5 most impactful next moves, ranked by urgency × impact. Mix RAMP score gaps with tool signals.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short action title' },
          rationale: { type: 'string', description: '1-2 sentence why, citing specific metric, risk, or tool signal' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['title', 'rationale', 'impact']
      }
    },
    risks: {
      type: 'array',
      description: 'Up to 8 risk flags — inferred from RAMP scores, notes, tool signals (PFMEA, BOM churn, overdue action items), and gate timing.',
      items: {
        type: 'object',
        properties: {
          flag: { type: 'string', description: 'Risk description, max 20 words' },
          source: {
            type: 'string',
            description: 'Which metric / tool / note surfaced this (e.g. "PFMEA · Soldering defect RPN 280", "BOM Pulse · 3 supplier swaps post-CDR")'
          },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['flag', 'source', 'severity']
      }
    }
  },
  required: ['statusSnapshot', 'narrative', 'topActions', 'risks']
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

// ---------------------------------------------------------------------------
// Tool context shapes — mirrors aiClient.ts ToolContext (kept in sync manually
// since server handlers can't cross-import client TS files at runtime).
// ---------------------------------------------------------------------------

interface TaktSignal {
  studyName: string;
  taktSec: number;
  bottleneckSec: number;
  balanceLoss: number;
  capacity: 'green' | 'yellow' | 'red';
  completedAtMs: number;
}

interface PFMEASignal {
  title: string;
  dateMs: number;
  totalRisks: number;
  highCount: number;
  mediumCount: number;
  maxRpn: number;
  topRisks: Array<{ processStep: string; failureMode: string; rpn: number }>;
}

interface MeetingSignal {
  dateMs: number;
  title: string;
  type: 'Internal' | 'External';
  hasActionItems: boolean;
  actionItemsPreview?: string;
}

interface BomSignal {
  versionLabel?: string;
  uploadedAtMs: number;
  effectiveDateMs?: number;
  reasonForChange?: string;
  totalLines: number;
  diff?: {
    added: number;
    removed: number;
    changed: number;
    supplierSwapCount: number;
    costDelta: number;
  };
  aiImpactNarrative?: string;
  eco?: {
    ref: string;
    title?: string;
    status: string;
    area: string;
    blocking: boolean;
  };
}

interface DecisionSignal {
  title: string;
  dateMs: number;
  decisionMaker: string;
  description: string;
  rationale: string;
  relatedRisks?: string;
  impact?: string;
  status: 'active' | 'superseded' | 'reversed';
  category: string;
  gate?: string;
}

// Mirrors aiClient.ts LessonSignal — inlined per Vercel bundler .ts gotcha.
interface LessonSignal {
  title: string;
  dateMs: number;
  category: string;
  lessonType: 'problem' | 'improvement' | 'best_practice';
  status: 'open' | 'in_progress' | 'closed';
  gate?: string;
  description: string;
  rootCause?: string;
  openMustActions: Array<{ text: string; owner?: string; targetDateMs?: number }>;
  totalMust: number;
  totalNice: number;
}

// Mirrors aiClient.ts ControlPlanSignal — inlined per Vercel bundler .ts gotcha.
interface ControlPlanSignal {
  title: string;
  planType: 'prototype' | 'pre_launch' | 'production';
  dateMs: number;
  totalItems: number;
  criticalCount: number;
  significantCount: number;
  topItems: Array<{
    processStep: string;
    characteristic?: string;
    specialClass: string;
    controlMethod?: string;
    reactionPlan?: string;
  }>;
}

interface ToolContext {
  takt?: TaktSignal;
  pfmeas?: PFMEASignal[];
  recentMeetings?: MeetingSignal[];
  latestBom?: BomSignal;
  decisions?: DecisionSignal[];
  lessons?: LessonSignal[];
  controlPlan?: ControlPlanSignal;
}

// Mirrors aiClient.ts ConnectedProjectContext — inlined per Vercel bundler
// .ts extension gotcha (cross-file TS imports fail at runtime in serverless).
interface ConnectedProjectContext {
  projectId: string;
  projectName: string;
  pfmeas?: PFMEASignal[];
  latestBom?: BomSignal;
  decisions?: DecisionSignal[];
}

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
  // Live signals from per-project tools — wired in when the user clicks
  // "Analyze" so the AI sees real tool data alongside the RAMP scores.
  toolContext?: ToolContext;
  // Signals from connected projects — enables cross-project drift detection,
  // risk propagation, and supplier-chain awareness.
  connectedProjectsContext?: ConnectedProjectContext[];
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

  // -------------------------------------------------------------------
  // Live Tool Signals — real data from per-project tools.
  // These are first-class inputs, not just score hints.
  // -------------------------------------------------------------------
  const tc = p.toolContext;
  const hasToolContext = tc && (tc.takt || tc.pfmeas?.length || tc.recentMeetings?.length || tc.latestBom || tc.decisions?.length);

  if (hasToolContext) {
    lines.push('');
    lines.push('## Live Tool Signals');
    lines.push('(These are actual recorded data from the project tools — treat them as primary evidence alongside the RAMP scores.)');

    if (tc!.takt) {
      const t = tc!.takt;
      const balPct = (t.balanceLoss * 100).toFixed(0);
      const headroom = t.taktSec > 0
        ? (((t.taktSec - t.bottleneckSec) / t.taktSec) * 100).toFixed(0)
        : '0';
      const completedDate = new Date(t.completedAtMs).toISOString().slice(0, 10);
      lines.push('');
      lines.push(`### Takt / Capacity Study: "${t.studyName}" (completed ${completedDate})`);
      lines.push(`- Takt time: ${t.taktSec.toFixed(1)}s | Bottleneck: ${t.bottleneckSec.toFixed(1)}s | Headroom: ${headroom}%`);
      lines.push(`- Line balance loss: ${balPct}% | Capacity verdict: ${t.capacity.toUpperCase()}`);
      if (t.capacity === 'red') lines.push('  ⚠ CAPACITY CRITICAL — bottleneck exceeds takt; line cannot meet demand rate.');
      else if (t.capacity === 'yellow') lines.push('  ⚠ CAPACITY AT-RISK — slim headroom; any variation could cause misses.');
    }

    if (tc!.pfmeas && tc!.pfmeas.length > 0) {
      lines.push('');
      lines.push(`### PFMEA (${tc!.pfmeas.length} analysis${tc!.pfmeas.length > 1 ? 'es' : ''})`);
      for (const pfmea of tc!.pfmeas) {
        const date = new Date(pfmea.dateMs).toISOString().slice(0, 10);
        lines.push(`**"${pfmea.title}"** (${date}): ${pfmea.totalRisks} risks — ${pfmea.highCount} HIGH / ${pfmea.mediumCount} MEDIUM | Max RPN: ${pfmea.maxRpn}`);
        if (pfmea.topRisks.length > 0) {
          lines.push('  Top risks by RPN:');
          for (const r of pfmea.topRisks) {
            lines.push(`    - [RPN ${r.rpn}] Step: "${r.processStep}" → Failure: "${r.failureMode}"`);
          }
        }
      }
    }

    if (tc!.recentMeetings && tc!.recentMeetings.length > 0) {
      lines.push('');
      lines.push(`### Recent Meetings (last ${tc!.recentMeetings.length})`);
      const withActions = tc!.recentMeetings.filter((m) => m.hasActionItems);
      lines.push(`${tc!.recentMeetings.length} meetings recorded; ${withActions.length} have open action items.`);
      for (const m of withActions.slice(0, 3)) {
        const date = new Date(m.dateMs).toISOString().slice(0, 10);
        lines.push(`- ${date} [${m.type}] "${m.title}"${m.actionItemsPreview ? ` — Actions: "${m.actionItemsPreview}"` : ''}`);
      }
      if (withActions.length === 0) {
        lines.push('No meetings have logged action items.');
      }
    }

    if (tc!.latestBom) {
      const b = tc!.latestBom;
      const uploadDate = new Date(b.uploadedAtMs).toISOString().slice(0, 10);
      lines.push('');
      lines.push(`### BOM Pulse — Latest BOM${b.versionLabel ? ` (${b.versionLabel})` : ''} uploaded ${uploadDate}`);
      lines.push(`- ${b.totalLines} line items`);
      if (b.reasonForChange) lines.push(`- Reason for change: "${b.reasonForChange}"`);
      if (b.diff) {
        const d = b.diff;
        lines.push(`- Delta vs prior: +${d.added} added / -${d.removed} removed / ${d.changed} changed | ${d.supplierSwapCount} supplier swap(s) | Cost delta: $${d.costDelta.toFixed(2)}`);
        if (d.supplierSwapCount > 0) {
          lines.push(`  ⚠ Supplier swap(s) detected — re-qualification risk, especially if post-CDR.`);
        }
      }
      if (b.aiImpactNarrative) {
        lines.push(`- Prior AI impact assessment: "${b.aiImpactNarrative.slice(0, 400)}${b.aiImpactNarrative.length > 400 ? '…' : ''}"`);
      }
      if (b.eco) {
        const ecoStatus = b.eco.status.replace('_', ' ');
        lines.push(`- ECO reference: ${b.eco.ref}${b.eco.title ? ` — "${b.eco.title}"` : ''}`);
        lines.push(`  Status: ${ecoStatus} | Area: ${b.eco.area}${b.eco.blocking ? ' | ⚠ BLOCKING GATE DELIVERABLE' : ''}`);
        if (b.eco.status === 'open' || b.eco.status === 'under_review') {
          lines.push(`  ⚠ ECO is not yet implemented — design may not be frozen. Flag any gate readiness items that depend on this change.`);
        }
        if (b.eco.blocking) {
          lines.push(`  ⚠⚠ This ECO is explicitly flagged as blocking a gate deliverable — escalate in topActions.`);
        }
      }
    }

    if (tc!.decisions && tc!.decisions.length > 0) {
      const allDecisions  = tc!.decisions;
      const active        = allDecisions.filter(d => d.status === 'active');
      const reversed      = allDecisions.filter(d => d.status === 'reversed');
      const superseded    = allDecisions.filter(d => d.status === 'superseded');
      lines.push('');
      lines.push(`### Decision Ledger (${allDecisions.length} decision${allDecisions.length !== 1 ? 's' : ''}: ${active.length} active, ${superseded.length} superseded, ${reversed.length} reversed)`);
      lines.push('(Use these for: drift detection — does a later BOM change or PFMEA risk contradict an earlier decision? risk memory — does the decision\'s stated risk now show up in PFMEA high-RPN? instability signal — repeated reversals suggest design churn.)');
      if (reversed.length > 0) {
        lines.push(`⚠ ${reversed.length} decision(s) REVERSED — each reversal is a signal of design instability or new information invalidating prior assumptions. Weight these heavily in risk assessment.`);
      }
      for (const d of active.slice(0, 5)) {
        const date = new Date(d.dateMs).toISOString().slice(0, 10);
        lines.push(`- [${date}${d.gate ? ` @${d.gate}` : ''} | ${d.category}] "${d.title}" — By: ${d.decisionMaker || 'unspecified'}`);
        lines.push(`    WHAT: ${d.description.slice(0, 300)}`);
        if (d.rationale)    lines.push(`    WHY: ${d.rationale.slice(0, 200)}`);
        if (d.relatedRisks) lines.push(`    RISKS NOTED: ${d.relatedRisks.slice(0, 200)}`);
        if (d.impact)       lines.push(`    EXPECTED IMPACT: ${d.impact.slice(0, 200)}`);
      }
      if (reversed.length > 0) {
        lines.push('  Reversed decisions (traceability):');
        for (const d of reversed) {
          const date = new Date(d.dateMs).toISOString().slice(0, 10);
          lines.push(`  - [REVERSED ${date}] "${d.title}"`);
          if (d.rationale) lines.push(`      Original rationale: ${d.rationale.slice(0, 150)}`);
        }
      }
    }

    // Lessons & Learned
    if (tc.lessons && tc.lessons.length > 0) {
      const openLessons  = tc.lessons.filter(l => l.status !== 'closed');
      const closedLessons = tc.lessons.filter(l => l.status === 'closed');
      const totalMustPending = tc.lessons.reduce((sum, l) => sum + l.openMustActions.length, 0);
      lines.push('');
      lines.push(`### Lessons & Learned (${tc.lessons.length} lesson${tc.lessons.length !== 1 ? 's' : ''}: ${openLessons.length} open/in-progress, ${closedLessons.length} closed)`);
      lines.push('(Use these for: pattern recognition — do recurring root causes indicate a systemic gap? action tracking — are MUST actions being closed before the next gate? risk foresight — do open lessons point to risks that haven\'t surfaced in PFMEA yet?)');
      if (totalMustPending > 0) {
        lines.push(`⚠ ${totalMustPending} MUST action${totalMustPending !== 1 ? 's' : ''} still open — flag if any are overdue relative to the current gate.`);
      }
      for (const l of tc.lessons) {
        const date = new Date(l.dateMs).toISOString().slice(0, 10);
        const typeLabel = l.lessonType === 'best_practice' ? 'BEST PRACTICE' : l.lessonType.toUpperCase();
        lines.push(`- [${date}${l.gate ? ` @${l.gate}` : ''} | ${l.category} | ${typeLabel} | ${l.status.toUpperCase()}] "${l.title}"`);
        lines.push(`    WHAT: ${l.description.slice(0, 250)}`);
        if (l.rootCause) lines.push(`    ROOT CAUSE: ${l.rootCause.slice(0, 200)}`);
        if (l.openMustActions.length > 0) {
          lines.push(`    OPEN MUST ACTIONS (${l.openMustActions.length}):`);
          for (const a of l.openMustActions) {
            const due = a.targetDateMs
              ? ` [due ${new Date(a.targetDateMs).toISOString().slice(0, 10)}]`
              : '';
            const owner = a.owner ? ` — ${a.owner}` : '';
            lines.push(`      • ${a.text.slice(0, 120)}${owner}${due}`);
          }
        }
        if (l.totalNice > 0) {
          lines.push(`    (+${l.totalNice} nice-to-have action${l.totalNice > 1 ? 's' : ''})`);
        }
      }
    }

    // Control Plan
    const cp = tc.controlPlan;
    if (cp) {
      const planTypeLabel = cp.planType === 'pre_launch' ? 'Pre-Launch' : cp.planType === 'production' ? 'Production' : 'Prototype';
      const cpDate = new Date(cp.dateMs).toISOString().slice(0, 10);
      lines.push('');
      lines.push(`### Control Plan (${planTypeLabel}, rev ${cpDate}: ${cp.totalItems} control item${cp.totalItems !== 1 ? 's' : ''})`);
      lines.push('(Use for: gate-readiness — is a Production Control Plan in place before PRR/MP? critical characteristic coverage — are all SC/CC items controlled? reaction plan gaps — do high-severity PFMEA risks have a corresponding control method and reaction plan here?)');
      if (cp.criticalCount > 0 || cp.significantCount > 0) {
        lines.push(`⚠ ${cp.criticalCount} Critical characteristic${cp.criticalCount !== 1 ? 's' : ''}, ${cp.significantCount} Significant characteristic${cp.significantCount !== 1 ? 's' : ''} — verify controls are adequate.`);
      }
      if (cp.topItems.length > 0) {
        lines.push('Top control items (critical/significant first):');
        for (const item of cp.topItems) {
          const cls = item.specialClass === 'critical' ? 'CC' : item.specialClass === 'significant' ? 'SC' : '';
          const char = item.characteristic ? ` | ${item.characteristic.slice(0, 60)}` : '';
          lines.push(`  - [${item.processStep.slice(0, 60)}]${char}${cls ? ` (${cls})` : ''}`);
          if (item.controlMethod) lines.push(`    Control: ${item.controlMethod.slice(0, 100)}`);
          if (item.reactionPlan)  lines.push(`    Reaction: ${item.reactionPlan.slice(0, 100)}`);
        }
      }
      if (cp.planType !== 'production') {
        lines.push(`⚠ Current plan type is ${planTypeLabel} — a Production Control Plan is typically required before MP gate.`);
      }
    }
  }

  // -------------------------------------------------------------------
  // Cross-Project Signals — data from connected projects.
  // Enables drift detection, risk propagation, and supplier-chain
  // awareness when this project is explicitly linked to others.
  // -------------------------------------------------------------------
  const cpc = p.connectedProjectsContext;
  if (cpc && cpc.length > 0) {
    lines.push('');
    lines.push('## Cross-Project Signals');
    lines.push(`This project is connected to ${cpc.length} other project(s). Use these signals for:`);
    lines.push('  - DRIFT DETECTION: Does a BOM change or decision in a connected project contradict a decision made here?');
    lines.push('  - RISK PROPAGATION: Does a high-RPN PFMEA risk in a connected project also affect this project\'s process steps or components?');
    lines.push('  - SUPPLIER-CHAIN AWARENESS: Supplier swaps in connected projects may share the same vendor — flag shared exposure.');
    lines.push('  - DEPENDENCY RISK: If a connected project is slipping or has high instability (reversed decisions), flag schedule dependencies.');
    lines.push('(Surface any cross-project finding as a risk flag with source attribution like "Cross-project · <ProjectName>")');

    for (const conn of cpc) {
      lines.push('');
      lines.push(`### Connected Project: "${conn.projectName}"`);

      if (conn.pfmeas && conn.pfmeas.length > 0) {
        for (const pfmea of conn.pfmeas) {
          const date = new Date(pfmea.dateMs).toISOString().slice(0, 10);
          lines.push(`**PFMEA "${pfmea.title}"** (${date}): ${pfmea.totalRisks} risks — ${pfmea.highCount} HIGH | Max RPN: ${pfmea.maxRpn}`);
          if (pfmea.topRisks.length > 0) {
            for (const r of pfmea.topRisks) {
              lines.push(`  - [RPN ${r.rpn}] "${r.processStep}" → "${r.failureMode}"`);
            }
          }
        }
      }

      if (conn.latestBom) {
        const b = conn.latestBom;
        const date = new Date(b.uploadedAtMs).toISOString().slice(0, 10);
        lines.push(`**BOM Pulse** (uploaded ${date}): ${b.totalLines} lines${b.versionLabel ? ` · ${b.versionLabel}` : ''}`);
        if (b.reasonForChange) lines.push(`  Reason for change: "${b.reasonForChange}"`);
        if (b.diff) {
          const d = b.diff;
          lines.push(`  Delta: +${d.added} / -${d.removed} / ${d.changed} changed | ${d.supplierSwapCount} supplier swap(s)`);
          if (d.supplierSwapCount > 0) lines.push('  ⚠ Supplier swaps — check if this project shares any affected vendors.');
        }
      }

      if (conn.decisions && conn.decisions.length > 0) {
        const active   = conn.decisions.filter((d) => d.status === 'active');
        const reversed = conn.decisions.filter((d) => d.status === 'reversed');
        lines.push(`**Decision Ledger**: ${active.length} active, ${reversed.length} reversed`);
        if (reversed.length > 0) {
          lines.push(`  ⚠ ${reversed.length} reversed decision(s) in connected project — may signal upstream design churn.`);
          for (const d of reversed) {
            lines.push(`  - [REVERSED] "${d.title}"`);
          }
        }
        for (const d of active.slice(0, 3)) {
          const date = new Date(d.dateMs).toISOString().slice(0, 10);
          lines.push(`  - [${date} | ${d.category}] "${d.title}" — ${d.description.slice(0, 150)}`);
          if (d.relatedRisks) lines.push(`    Risks noted: ${d.relatedRisks.slice(0, 100)}`);
        }
      }
    }
  }

  lines.push('');
  lines.push('Your job (be concise — stay within the token budget):');
  lines.push(
    '0. statusSnapshot — EXACTLY one sentence (≤25 words) YTD verdict. Format: "<Project> is <on track / at risk / slipping> for <next gate or current gate> — <sharpest single observation>." Make it specific — include the score, gate name, or a key tool signal.'
  );
  lines.push(
    '1. narrative — 3 short paragraphs (~200 words total): (1) Overall RAMP readiness — score, strongest/weakest buckets, gate position. (2) Tool signals synthesis — what PFMEA, BOM Pulse, meetings, takt data reveal about real-world status. Skip this para if no tool context was provided. (3) Schedule outlook — days to next gate, on-track vs at-risk assessment, single biggest open question.'
  );
  lines.push(
    '2. topActions — exactly 5 moves, ranked by urgency × impact. Draw from BOTH RAMP score gaps AND tool signals (e.g. unresolved PFMEA high-RPN, BOM supplier swaps needing requalification, overdue meeting action items, capacity shortfalls, decision drift). Each: short title, 1–2 sentence rationale citing specific metrics or tool findings by name.'
  );
  lines.push(
    '3. risks — up to 8 risks, sourced from RAMP scores, notes, tool signals, AND cross-project signals. Prioritize: PFMEA high-RPN items, supplier swaps post-CDR, takt capacity RED/YELLOW, overdue action items, gate-slip risk, decision drift (later evidence contradicts an earlier decision), risk memory (a risk noted in a decision now shows as high-RPN in PFMEA), instability (repeated decision reversals), and cross-project risks (shared suppliers, upstream design churn, dependency slippage). Source attribution for cross-project risks should read e.g. "Cross-project · <ProjectName> · PFMEA".'
  );
  if (selectedStandards.length > 0) {
    lines.push('');
    lines.push(
      'Compliance weighting: When assessing topActions and risks, give additional weight to gaps that would create a non-conformance or audit finding against the Applicable Standards listed above. Where a low-scoring item has a direct tie-in (e.g. Design Controls ↔ ISO 13485 §7.3, Software Lifecycle ↔ IEC 62304, Functional Safety ↔ ISO 26262), call out the standard by name in the rationale or flag. Do NOT cite specific clause numbers unless you are highly confident; stick to the standard identifier.'
    );
  }
  lines.push('');
  lines.push(
    'Be concrete and specific. Avoid filler and generic advice. Anchor everything to the data provided — especially tool signals when available. Keep sentences tight.'
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
    statusSnapshot: String(parsed.statusSnapshot || ''),
    narrative: String(parsed.narrative || ''),
    topActions: Array.isArray(parsed.topActions) ? parsed.topActions : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    generatedAt: Date.now()
  });
}
