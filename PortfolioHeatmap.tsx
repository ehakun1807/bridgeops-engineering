// ---------------------------------------------------------------------------
// PortfolioHeatmap — a compact projects × parameter-groups matrix that sits
// above the Active Projects list. Each row is a project, each column is one
// of the 4 Ramp Readiness groups (Product/Design, Manufacturing, Supply,
// Quality). Cells are colored by the group score band.
//
// Click any row to jump into that project's workspace. Gate badge shown on
// the right so the operator can see where each project is in the lifecycle.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { ChevronRight, Grid3x3 } from 'lucide-react';
import {
  RAMP_GROUPS,
  scoreForGroup,
  scoreForProject,
  scoreBand,
  enabledCountForGroup,
  deriveDeliverableScores
} from './rampGroups';
import type { ProductGate, SubItemDeliverables } from './ProjectDeepDive';
import { TOTAL_ITEM_COUNT } from './templates';
import GateDeliverablesModal from './GateDeliverablesModal.tsx';

// Minimal shape needed for the heatmap — matches the ProjectRecord fields
// Dashboard already holds, but kept loose to avoid tight coupling.
export interface PortfolioProject {
  id: string;
  name: string;
  productType?: string;
  metrics?: Record<string, number>;
  lastScore?: number;
  currentGate?: ProductGate;
  disabledItemIds?: string[];
  // Needed for the gate-deliverables popup launched from the gate chip. Safe
  // to omit — the modal falls back to an empty map and simply shows every
  // deliverable as pending in that case.
  deliverables?: Record<string, SubItemDeliverables>;
}

interface PortfolioHeatmapProps {
  projects: PortfolioProject[];
  onSelect: (projectId: string) => void;
}

function cellStyle(score: number): { bg: string; text: string } {
  if (score >= 80) return { bg: 'bg-emerald-500', text: 'text-white' };
  if (score >= 60) return { bg: 'bg-blue-500', text: 'text-white' };
  if (score >= 40) return { bg: 'bg-amber-400', text: 'text-slate-900' };
  return { bg: 'bg-red-500', text: 'text-white' };
}

const PortfolioHeatmap: React.FC<PortfolioHeatmapProps> = ({ projects, onSelect }) => {
  // Sort by overall score ascending so weakest projects surface first.
  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      // Match ProjectDeepDive's blended rollup so the heatmap row order
      // tracks the same number the user sees inside the project.
      const sa = a.metrics
        ? scoreForProject(a.metrics, a.disabledItemIds, deriveDeliverableScores(a.deliverables))
        : (a.lastScore ?? 0);
      const sb = b.metrics
        ? scoreForProject(b.metrics, b.disabledItemIds, deriveDeliverableScores(b.deliverables))
        : (b.lastScore ?? 0);
      return sa - sb;
    });
  }, [projects]);

  // Gate-deliverables popup — opened by clicking a project's gate chip in
  // the heatmap. We hold the project id + gate here rather than passing the
  // full object around so the modal stays re-rendered when the underlying
  // project changes (e.g. a live Firestore update while the modal is open).
  const [gateModal, setGateModal] = useState<{
    projectId: string;
    gate: ProductGate;
  } | null>(null);
  const modalProject = useMemo(
    () => (gateModal ? projects.find((p) => p.id === gateModal.projectId) : undefined),
    [gateModal, projects]
  );

  if (sorted.length === 0) return null;

  return (
    <div className="bg-white rounded-sm shadow border border-slate-200 mb-8 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2">
          <Grid3x3 size={14} className="text-slate-500" />
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-600">
            Portfolio Health · {sorted.length} Project{sorted.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="hidden md:flex items-center gap-3 text-[9px] font-black uppercase tracking-widest text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 bg-red-500" /> &lt;40
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 bg-amber-400" /> 40–59
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 bg-blue-500" /> 60–79
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 bg-emerald-500" /> 80+
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60">
              <th className="text-left px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 min-w-[200px]">
                Project
              </th>
              <th className="text-center px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Gate
              </th>
              {RAMP_GROUPS.map((g) => {
                return (
                  <th
                    key={g.id}
                    className="text-center px-3 py-2 text-[10px] font-black uppercase tracking-widest whitespace-nowrap text-slate-500"
                    title={g.title}
                  >
                    {g.title.split(' ')[0]}
                  </th>
                );
              })}
              <th className="text-center px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Overall
              </th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const metrics = p.metrics || {};
              const disabled = p.disabledItemIds;
              // Single derivation per project — reused for both the overall
              // rollup and every group-cell call below so they're consistent.
              const ds = deriveDeliverableScores(p.deliverables);
              const overall = p.metrics
                ? scoreForProject(metrics, disabled, ds)
                : (p.lastScore ?? 0);
              const overallBand = scoreBand(overall);
              const enabledTotal = TOTAL_ITEM_COUNT - (disabled?.length ?? 0);
              const reducedScope = enabledTotal !== TOTAL_ITEM_COUNT;
              return (
                <tr
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-black text-slate-900 truncate">
                          {p.name}
                        </span>
                        {reducedScope && (
                          <span
                            className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 tabular-nums"
                            title={`Reduced scope: ${enabledTotal}/${TOTAL_ITEM_COUNT} metrics enabled`}
                          >
                            {enabledTotal}/{TOTAL_ITEM_COUNT}
                          </span>
                        )}
                      </div>
                      {p.productType && (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 truncate">
                          {p.productType}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {p.currentGate ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          // Don't let the click also open the project.
                          e.stopPropagation();
                          setGateModal({
                            projectId: p.id,
                            gate: p.currentGate as ProductGate
                          });
                        }}
                        className="inline-block bg-slate-900 text-white px-2 py-0.5 text-[10px] font-black tracking-widest hover:bg-blue-700 focus:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400/60 transition-colors cursor-pointer"
                        title={`View ${p.currentGate} deliverables`}
                        aria-label={`View ${p.currentGate} deliverables for ${p.name}`}
                      >
                        {p.currentGate}
                      </button>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  {RAMP_GROUPS.map((g) => {
                    const groupEnabled = enabledCountForGroup(g, disabled);
                    if (groupEnabled === 0) {
                      return (
                        <td key={g.id} className="px-2 py-2 text-center">
                          <div
                            className="inline-flex items-center justify-center w-12 h-8 text-[10px] font-black bg-slate-100 text-slate-400"
                            title={`${g.title}: out of scope`}
                          >
                            N/A
                          </div>
                        </td>
                      );
                    }
                    const s = p.metrics ? scoreForGroup(g, metrics, disabled, ds) : 0;
                    const cs = cellStyle(s);
                    return (
                      <td key={g.id} className="px-2 py-2 text-center">
                        <div
                          className={`inline-flex items-center justify-center w-12 h-8 text-xs font-black tabular-nums ${cs.bg} ${cs.text}`}
                          title={`${g.title}: ${s}% (${groupEnabled}/${g.items.length} enabled)`}
                        >
                          {s}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-base font-black tabular-nums ${overallBand.text}`}>
                      {overall}%
                    </span>
                  </td>
                  <td className="pr-4 text-right text-slate-400">
                    <ChevronRight size={14} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Gate deliverables popup — read-only view that lists every deliverable
          due by the project's current gate, grouped by sub-parameter. */}
      <GateDeliverablesModal
        open={!!gateModal && !!modalProject}
        onClose={() => setGateModal(null)}
        projectName={modalProject?.name || ''}
        productType={modalProject?.productType}
        gate={(gateModal?.gate || 'CR') as ProductGate}
        deliverables={modalProject?.deliverables || {}}
        disabledItemIds={modalProject?.disabledItemIds}
      />
    </div>
  );
};

export default PortfolioHeatmap;
