// ---------------------------------------------------------------------------
// Client-side helper for /api/ai-analyze.
// Builds the project payload from in-memory state, forwards the current user's
// Firebase ID token, returns the parsed analysis.
// ---------------------------------------------------------------------------

import { auth } from './firebase.ts';
import {
  RAMP_GROUPS,
  scoreForGroup,
  scoreForItem,
  scoreForProject,
  deriveDeliverableScores,
  effectiveMetrics
} from './rampGroups';

export interface AIAction {
  title: string;
  rationale: string;
  impact: 'high' | 'medium' | 'low';
}

export interface AIRisk {
  flag: string;
  source: string;
  severity: 'high' | 'medium' | 'low';
}

export interface AIAnalysis {
  statusSnapshot: string;  // 1-sentence YTD verdict shown prominently
  narrative: string;
  topActions: AIAction[];
  risks: AIRisk[];
  generatedAt: number;
}

export type ProductGate = 'CR' | 'PDR' | 'CDR' | 'TRR' | 'PRR' | 'MP';

// ---------------------------------------------------------------------------
// Tool context — live signals from the per-project tools. Fetched on demand
// just before running AI Analysis; not persisted in the cached result.
// ---------------------------------------------------------------------------

export interface PFMEASignal {
  title: string;
  dateMs: number;
  totalRisks: number;
  highCount: number;
  mediumCount: number;
  maxRpn: number;
  /** Top 3 highest-RPN risks, for the AI prompt. */
  topRisks: Array<{ processStep: string; failureMode: string; rpn: number }>;
}

export interface MeetingSignal {
  dateMs: number;
  title: string;
  type: 'Internal' | 'External';
  hasActionItems: boolean;
  /** First 300 chars of action items text, if any. */
  actionItemsPreview?: string;
}

export interface BomSignal {
  versionLabel?: string;
  uploadedAtMs: number;
  effectiveDateMs?: number;
  reasonForChange?: string;
  totalLines: number;
  /** Diff stats vs the prior BOM version, if available. */
  diff?: {
    added: number;
    removed: number;
    changed: number;
    supplierSwapCount: number;
    costDelta: number;
  };
  /** First 400 chars of any persisted AI impact narrative. */
  aiImpactNarrative?: string;
}

export interface TaktSignal {
  studyName: string;
  taktSec: number;
  bottleneckSec: number;
  /** 0–1 fraction */
  balanceLoss: number;
  capacity: 'green' | 'yellow' | 'red';
  completedAtMs: number;
}

export interface DecisionSignal {
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

export interface ToolContext {
  takt?: TaktSignal;
  pfmeas?: PFMEASignal[];            // up to 3 most-recent
  recentMeetings?: MeetingSignal[];  // up to 5 most-recent
  latestBom?: BomSignal;
  decisions?: DecisionSignal[];      // up to 5 active + any reversed, for drift/risk detection
}

/**
 * Signals from a single connected project — used to build cross-project
 * context for AI Analysis (drift detection, risk propagation, etc.).
 */
export interface ConnectedProjectContext {
  projectId: string;
  projectName: string;
  pfmeas?: PFMEASignal[];    // up to 2 most-recent
  latestBom?: BomSignal;
  decisions?: DecisionSignal[];  // active decisions + any reversed
}

export interface AnalyzeProjectInput {
  name: string;
  productType?: string;
  metrics: Record<string, number>;
  notes: Record<string, string>;
  startDate?: string;
  endDate?: string;
  infoStatus?: string;
  generalInfo?: string;
  currentGate?: ProductGate;
  gateTargets?: Partial<Record<ProductGate, string>>;
  // Sub-item IDs explicitly marked out-of-scope. These are excluded from the
  // payload entirely so the AI doesn't flag missing evidence on N/A metrics.
  disabledItemIds?: string[];
  templateName?: string;
  // Project-level applicable standards (e.g. ISO 13485, IEC 62304). Feeds
  // compliance-weighting into the AI risk analysis.
  standards?: string[];
  // Per-sub-item deliverable state (the on-disk shape from
  // project.deliverables). Used to blend deliverable completion into
  // value-kind scores so the AI sees the same numbers as the deep-dive.
  // Loose duck-typed shape mirrors deriveDeliverableScores in rampGroups.ts.
  deliverables?: Record<
    string,
    {
      checkedIds?: string[];
      hiddenTemplateIds?: string[];
      waivedTemplateIds?: string[];
      custom?: Array<{ done?: boolean; waived?: boolean }>;
    }
  >;
  // Live signals from per-project tools — fetched on demand just before
  // calling analyzeProject so the AI sees real tool data, not just scores.
  toolContext?: ToolContext;
  // Signals from connected projects — enables cross-project drift detection,
  // risk propagation, and supplier-chain awareness in the AI prompt.
  connectedProjectsContext?: ConnectedProjectContext[];
}

function buildSnapshot(input: AnalyzeProjectInput) {
  const disabled = new Set(input.disabledItemIds || []);
  // Match ProjectDeepDive precisely:
  //   - effectiveMetrics rewrites bar-kind metric values to their live
  //     deliverable %, mirroring the metrics-rewrite useEffect.
  //   - deriveDeliverableScores supplies the per-item blend % for value-kind
  //     items (scoreForItem averages numeric + deliverable 50/50).
  const liveMetrics = effectiveMetrics(input.metrics, input.deliverables);
  const ds = deriveDeliverableScores(input.deliverables);
  const overallScore = scoreForProject(liveMetrics, input.disabledItemIds, ds);
  const groups = RAMP_GROUPS.map((g) => {
    const enabledItems = g.items.filter((i) => !disabled.has(i.id));
    const score = scoreForGroup(g, liveMetrics, input.disabledItemIds, ds);
    return {
      title: g.title,
      subtitle: g.subtitle,
      score,
      enabledCount: enabledItems.length,
      totalCount: g.items.length,
      items: enabledItems.map((item) => {
        const value = liveMetrics[item.id] ?? item.defaultValue;
        return {
          title: item.title,
          question: item.question,
          tool: item.tool,
          unit: item.unit,
          value,
          score: scoreForItem(item, value, ds[item.id]),
          note: input.notes[item.id] || undefined
        };
      })
    };
  }).filter((g) => g.enabledCount > 0);
  // Count excluded items per group for the AI prompt — it should know the
  // scope is reduced without being tempted to score items it wasn't given.
  const excludedSummary = RAMP_GROUPS.map((g) => ({
    title: g.title,
    excluded: g.items.filter((i) => disabled.has(i.id)).map((i) => i.title)
  })).filter((g) => g.excluded.length > 0);
  return {
    name: input.name,
    productType: input.productType,
    overallScore,
    startDate: input.startDate,
    endDate: input.endDate,
    infoStatus: input.infoStatus,
    generalInfo: input.generalInfo,
    currentGate: input.currentGate,
    gateTargets: input.gateTargets,
    templateName: input.templateName,
    standards: Array.isArray(input.standards) ? input.standards : undefined,
    groups,
    excludedSummary: excludedSummary.length > 0 ? excludedSummary : undefined,
    toolContext: input.toolContext ?? undefined,
    connectedProjectsContext: input.connectedProjectsContext ?? undefined
  };
}

export async function analyzeProject(
  input: AnalyzeProjectInput
): Promise<AIAnalysis> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');

  // Pre-flight: empty scope (every metric disabled — common for fresh Custom
  // template projects) has nothing to analyze. Catch it here so the user sees
  // a clear message instead of a generic 502 from the handler.
  const snapshot = buildSnapshot(input);
  if (snapshot.groups.length === 0) {
    throw new Error(
      'No metrics in scope. Open the project scope and enable at least one metric before running AI Analysis.'
    );
  }

  // Force-refresh the token so we never send a just-expired one.
  const idToken = await user.getIdToken(false);

  const res = await fetch('/api/ai-analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ project: snapshot })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // Handler now returns { error, detail? } on 502 with the upstream Gemini
    // status + body — surface the detail to the user when present.
    const baseMsg = data?.error || `AI request failed (${res.status})`;
    const fullMsg = data?.detail ? `${baseMsg} — ${data.detail}` : baseMsg;
    throw new Error(fullMsg);
  }
  return (await res.json()) as AIAnalysis;
}
