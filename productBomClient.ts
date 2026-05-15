// ---------------------------------------------------------------------------
// Client-side helper for /api/bom-impact-analyze.
// Forwards the diff + project context to the serverless handler with the
// current user's Firebase ID token. Mirrors aiClient.ts patterns.
// ---------------------------------------------------------------------------

import { auth } from './firebase.ts';
import { RAMP_GROUPS } from './rampGroups.ts';
import type { BomDiff } from './bomDiff.ts';
import type { BomLine } from './bomParser.ts';

export interface AffectedRampItem {
  rampItemId: string;
  rampItemTitle: string;
  rationale: string;
  severity: 'high' | 'medium' | 'low';
}

export interface BomImpactRisk {
  flag: string;
  source: string;
  severity: 'high' | 'medium' | 'low';
}

export interface BomImpactAction {
  title: string;
  rationale: string;
  impact: 'high' | 'medium' | 'low';
}

export interface BomImpactAnalysis {
  narrative: string;
  affectedRampItems: AffectedRampItem[];
  newRisks: BomImpactRisk[];
  topActions: BomImpactAction[];
  generatedAt: number;
}

export type ProductGate = 'CR' | 'PDR' | 'CDR' | 'TRR' | 'PRR' | 'MP';

export interface AnalyzeBomImpactInput {
  projectName: string;
  productType?: string;
  currentGate?: ProductGate;
  gateTargets?: Partial<Record<ProductGate, string>>;
  standards?: string[];
  templateName?: string;
  disabledItemIds?: string[];   // determines which RAMP items are in scope
  baselineLabel?: string;
  currentLabel?: string;
  /** Date the new revision is effective (epoch ms). Used by the AI to frame
   *  schedule pressure ("change effective 7 days before TRR…"). */
  effectiveDateMs?: number;
  /** ECO# / supplier rationale / etc. — first-class signal the AI weighs. */
  reasonForChange?: string;
  /** True if any line carries a bomLevel — tells the AI this is a structured
   *  multi-level BOM and re-parenting events are meaningful. */
  isMultiLevel?: boolean;
  diff: BomDiff;
  pfmeaTopRisk?: string;
  taktSummary?: string;
  hasProcessMap?: boolean;
}

// Cap how many lines we ship over the wire — handler also caps in its prompt
// but we trim early to keep request body small. The summary already conveys
// magnitude when individual lines overflow.
const MAX_LINES_OVER_WIRE = 60;

function compactLine(l: BomLine) {
  return {
    bomLevel: l.bomLevel,
    internalPn: l.internalPn,
    mpn: l.mpn,
    manufacturer: l.manufacturer,
    description: l.description ? l.description.slice(0, 120) : undefined,
    refDes: l.refDes,
    qty: l.qty,
    unitCost: l.unitCost
  };
}

export async function analyzeBomImpact(
  input: AnalyzeBomImpactInput
): Promise<BomImpactAnalysis> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');

  // Build enabled-items list from RAMP_GROUPS minus the project's disabled set.
  const disabled = new Set(input.disabledItemIds || []);
  const enabledItems: Array<{ id: string; title: string; groupTitle: string }> = [];
  for (const g of RAMP_GROUPS) {
    for (const item of g.items) {
      if (disabled.has(item.id)) continue;
      enabledItems.push({ id: item.id, title: item.title, groupTitle: g.title });
    }
  }

  if (enabledItems.length === 0) {
    throw new Error(
      'No metrics in scope. Open the project scope and enable at least one metric before running BOM Impact Analysis.'
    );
  }

  const { added, removed, changed, summary } = input.diff;
  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    throw new Error('No changes detected between the two BOMs — nothing to analyze.');
  }

  const payload = {
    projectName: input.projectName,
    productType: input.productType,
    currentGate: input.currentGate,
    gateTargets: input.gateTargets,
    standards: input.standards,
    templateName: input.templateName,
    baselineLabel: input.baselineLabel,
    currentLabel: input.currentLabel,
    effectiveDateMs: input.effectiveDateMs,
    reasonForChange: input.reasonForChange,
    isMultiLevel: input.isMultiLevel,
    diffSummary: summary,
    added: added.slice(0, MAX_LINES_OVER_WIRE).map(compactLine),
    removed: removed.slice(0, MAX_LINES_OVER_WIRE).map(compactLine),
    changed: changed.slice(0, MAX_LINES_OVER_WIRE).map((c) => ({
      ...compactLine(c.after),
      before: compactLine(c.before),
      kinds: c.kinds
    })),
    enabledItems,
    pfmeaTopRisk: input.pfmeaTopRisk,
    taktSummary: input.taktSummary,
    hasProcessMap: input.hasProcessMap
  };

  const idToken = await user.getIdToken(false);
  const res = await fetch('/api/bom-impact-analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const baseMsg = data?.error || `BOM Impact request failed (${res.status})`;
    const fullMsg = data?.detail ? `${baseMsg} — ${data.detail}` : baseMsg;
    throw new Error(fullMsg);
  }
  return (await res.json()) as BomImpactAnalysis;
}
