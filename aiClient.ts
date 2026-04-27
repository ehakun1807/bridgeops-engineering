// ---------------------------------------------------------------------------
// Client-side helper for /api/ai-analyze.
// Builds the project payload from in-memory state, forwards the current user's
// Firebase ID token, returns the parsed analysis.
// ---------------------------------------------------------------------------

import { auth } from './firebase.ts';
import { RAMP_GROUPS, scoreForGroup, scoreForItem, scoreForProject } from './rampGroups';

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
  narrative: string;
  topActions: AIAction[];
  risks: AIRisk[];
  generatedAt: number;
}

export type ProductGate = 'CR' | 'PDR' | 'CDR' | 'TRR' | 'PRR' | 'MP';

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
}

function buildSnapshot(input: AnalyzeProjectInput) {
  const disabled = new Set(input.disabledItemIds || []);
  const overallScore = scoreForProject(input.metrics, input.disabledItemIds);
  const groups = RAMP_GROUPS.map((g) => {
    const enabledItems = g.items.filter((i) => !disabled.has(i.id));
    const score = scoreForGroup(g, input.metrics, input.disabledItemIds);
    return {
      title: g.title,
      subtitle: g.subtitle,
      score,
      enabledCount: enabledItems.length,
      totalCount: g.items.length,
      items: enabledItems.map((item) => {
        const value = input.metrics[item.id] ?? item.defaultValue;
        return {
          title: item.title,
          question: item.question,
          tool: item.tool,
          unit: item.unit,
          value,
          score: scoreForItem(item, value),
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
    excludedSummary: excludedSummary.length > 0 ? excludedSummary : undefined
  };
}

export async function analyzeProject(
  input: AnalyzeProjectInput
): Promise<AIAnalysis> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');

  // Force-refresh the token so we never send a just-expired one.
  const idToken = await user.getIdToken(false);

  const res = await fetch('/api/ai-analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ project: buildSnapshot(input) })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `AI request failed (${res.status})`);
  }
  return (await res.json()) as AIAnalysis;
}
