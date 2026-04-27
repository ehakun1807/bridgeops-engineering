// ---------------------------------------------------------------------------
// GateDeliverablesModal — read-only popup that opens from the dashboard gate
// chip. For a given project + its currentGate, gathers every deliverable
// whose `dueBy` matches that gate across all 4 parameter groups and shows
// their status (done / pending / waived). Useful for a quick pre-gate-review
// glance without having to open the project.
//
// Out-of-scope sub-items are hidden — a disabled metric can't block the gate.
// Hidden template deliverables are likewise skipped. Custom deliverables the
// team added to a sub-item are included when their `dueBy` matches.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckSquare, Square, FileWarning, X, ClipboardList } from 'lucide-react';
import { RAMP_GROUPS, accentTokens } from './rampGroups';
import type {
  ProductGate,
  SubItemDeliverables,
  CustomDeliverable
} from './ProjectDeepDive';

export interface GateDeliverablesModalProps {
  open: boolean;
  onClose: () => void;
  projectName: string;
  productType?: string;
  gate: ProductGate;
  deliverables: Record<string, SubItemDeliverables>;
  disabledItemIds?: string[];
}

type Status = 'done' | 'waived' | 'pending';

interface Row {
  kind: 'template' | 'custom';
  id: string;
  title: string;
  status: Status;
  waiverReason?: string;
}

interface Section {
  subItemId: string;
  subItemTitle: string;
  groupTitle: string;
  groupAccent: 'blue' | 'emerald' | 'amber' | 'violet';
  rows: Row[];
}

const GATE_LABELS: Record<ProductGate, string> = {
  'CR':  'CR — Concept Review',
  'PDR': 'PDR — Preliminary Design Review',
  'CDR': 'CDR — Critical Design Review',
  'TRR': 'TRR — Test Readiness Review',
  'PRR': 'PRR — Production Readiness Review',
  'MP':  'MP — Mass Production'
};

const GATE_CHIP_STYLES: Record<ProductGate, string> = {
  'CR':  'bg-slate-100 text-slate-700 border-slate-200',
  'PDR': 'bg-blue-50 text-blue-700 border-blue-200',
  'CDR': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'TRR': 'bg-amber-50 text-amber-700 border-amber-200',
  'PRR': 'bg-rose-50 text-rose-700 border-rose-200',
  'MP':  'bg-emerald-50 text-emerald-700 border-emerald-200'
};

const statusFromTemplate = (
  templateId: string,
  state: SubItemDeliverables
): Status => {
  const waived = new Set(state.waivedTemplateIds || []);
  if (waived.has(templateId)) return 'waived';
  const checked = new Set(state.checkedIds || []);
  if (checked.has(templateId)) return 'done';
  return 'pending';
};

const statusFromCustom = (c: CustomDeliverable): Status => {
  if (c.waived) return 'waived';
  if (c.done) return 'done';
  return 'pending';
};

const GateDeliverablesModal: React.FC<GateDeliverablesModalProps> = ({
  open,
  onClose,
  projectName,
  productType,
  gate,
  deliverables,
  disabledItemIds
}) => {
  // ESC closes. Bound while open; cleaned up on close/unmount.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const disabledSet = useMemo(
    () => new Set(disabledItemIds || []),
    [disabledItemIds]
  );

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    RAMP_GROUPS.forEach((group) => {
      group.items.forEach((item) => {
        if (disabledSet.has(item.id)) return;
        const state: SubItemDeliverables = deliverables?.[item.id] || {
          checkedIds: []
        };
        const hidden = new Set(state.hiddenTemplateIds || []);
        const rows: Row[] = [];

        (item.deliverables || []).forEach((t) => {
          if (t.dueBy !== gate) return;
          if (hidden.has(t.id)) return;
          const status = statusFromTemplate(t.id, state);
          rows.push({
            kind: 'template',
            id: t.id,
            title: t.title,
            status,
            waiverReason:
              status === 'waived' ? state.waiverReasons?.[t.id] : undefined
          });
        });

        (state.custom || []).forEach((c) => {
          if (c.dueBy !== gate) return;
          rows.push({
            kind: 'custom',
            id: c.id,
            title: c.title,
            status: statusFromCustom(c),
            waiverReason: c.waived ? c.waiverReason : undefined
          });
        });

        if (rows.length > 0) {
          out.push({
            subItemId: item.id,
            subItemTitle: item.title,
            groupTitle: group.title,
            groupAccent: group.accent,
            rows
          });
        }
      });
    });
    return out;
  }, [deliverables, disabledSet, gate]);

  const totals = useMemo(() => {
    let total = 0;
    let done = 0;
    let waived = 0;
    sections.forEach((s) =>
      s.rows.forEach((r) => {
        total += 1;
        if (r.status === 'done' || r.status === 'waived') done += 1;
        if (r.status === 'waived') waived += 1;
      })
    );
    return { total, done, waived };
  }, [sections]);

  const pct = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="bg-white w-full max-w-3xl max-h-[85vh] rounded-sm shadow-2xl overflow-hidden flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gate-deliverables-title"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <ClipboardList size={18} className="text-blue-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/70 mb-1 truncate">
                    {productType ? `${productType} · ${projectName}` : projectName}
                  </p>
                  <h3
                    id="gate-deliverables-title"
                    className="text-lg font-black uppercase tracking-tight leading-tight flex items-center gap-2"
                  >
                    <span
                      className={`inline-block px-2 py-0.5 text-[10px] font-black tracking-widest border rounded-sm ${GATE_CHIP_STYLES[gate]}`}
                      title={GATE_LABELS[gate]}
                    >
                      {gate}
                    </span>
                    Gate Deliverables
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-white/60 hover:text-white transition-colors flex-shrink-0"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Summary strip */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-4 flex-shrink-0">
              <p className="text-[11px] font-medium text-slate-600 leading-snug max-w-lg">
                Every in-scope deliverable due by{' '}
                <span className="font-black">{GATE_LABELS[gate]}</span>,
                grouped by sub-parameter. Read-only snapshot — open the project to
                make changes.
              </p>
              <div className="text-right flex-shrink-0">
                <div className="text-2xl font-black tracking-tighter text-slate-900 tabular-nums">
                  {totals.total > 0 ? `${pct}%` : '—'}
                </div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 tabular-nums">
                  {totals.done}/{totals.total} done
                  {totals.waived > 0 && (
                    <>
                      {' · '}
                      <span className="text-amber-700">{totals.waived} waived</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {sections.length === 0 ? (
                <p className="text-[11px] font-medium text-slate-400 italic">
                  No deliverables are assigned to{' '}
                  <span className="font-black">{gate}</span> in this project's
                  in-scope sub-parameters. Assign{' '}
                  <span className="font-black">Due by: {gate}</span> to
                  deliverables in the deep-dive view to populate this list.
                </p>
              ) : (
                sections.map((section) => {
                  const tokens = accentTokens[section.groupAccent];
                  const sectionDone = section.rows.filter(
                    (r) => r.status === 'done' || r.status === 'waived'
                  ).length;
                  const sectionWaived = section.rows.filter(
                    (r) => r.status === 'waived'
                  ).length;
                  return (
                    <div
                      key={section.subItemId}
                      className="border border-slate-200 rounded-sm"
                    >
                      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-50 border-b border-slate-200">
                        <div className="min-w-0">
                          <div
                            className={`text-[9px] font-black uppercase tracking-widest ${tokens.text} mb-0.5`}
                          >
                            {section.groupTitle}
                          </div>
                          <div className="text-[11px] font-black uppercase tracking-tight text-slate-800 truncate">
                            {section.subItemTitle}
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-[10px] font-black tabular-nums text-slate-500">
                          {sectionDone}/{section.rows.length}
                          {sectionWaived > 0 && (
                            <span className="ml-1 text-amber-700">
                              · {sectionWaived} waived
                            </span>
                          )}
                        </div>
                      </div>
                      <ul className="divide-y divide-slate-100">
                        {section.rows.map((row) => (
                          <li
                            key={`${row.kind}:${row.id}`}
                            className={`flex flex-col gap-1 px-3 py-2 ${
                              row.status === 'waived' ? 'bg-amber-50/50' : ''
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <span
                                className="flex-shrink-0 mt-0.5"
                                aria-label={row.status}
                                title={
                                  row.status === 'waived'
                                    ? 'Waived'
                                    : row.status === 'done'
                                    ? 'Done'
                                    : 'Pending'
                                }
                              >
                                {row.status === 'waived' ? (
                                  <FileWarning
                                    size={14}
                                    className="text-amber-600"
                                  />
                                ) : row.status === 'done' ? (
                                  <CheckSquare
                                    size={14}
                                    className="text-emerald-600"
                                  />
                                ) : (
                                  <Square size={14} className="text-slate-400" />
                                )}
                              </span>
                              <span
                                className={`flex-1 text-[11px] leading-snug ${
                                  row.status === 'waived'
                                    ? 'text-amber-800 line-through decoration-amber-400/70'
                                    : row.status === 'done'
                                    ? 'text-slate-400 line-through'
                                    : 'text-slate-700 font-medium'
                                }`}
                              >
                                {row.title}
                                {row.kind === 'custom' && (
                                  <span className="ml-2 px-1 py-[0px] text-[8px] font-black uppercase tracking-widest text-slate-400 border border-slate-200 rounded-sm">
                                    custom
                                  </span>
                                )}
                              </span>
                              {row.status === 'waived' && (
                                <span
                                  className="flex-shrink-0 mt-0.5 px-1.5 py-[1px] text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 border border-amber-300 rounded-sm"
                                  title="Formally accepted deviation"
                                >
                                  Waived
                                </span>
                              )}
                            </div>
                            {row.status === 'waived' && row.waiverReason && (
                              <div className="pl-5 text-[10px] text-amber-800/90 leading-snug italic">
                                Reason: {row.waiverReason}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end flex-shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="text-[10px] font-black uppercase tracking-widest px-4 py-2 bg-slate-900 text-white hover:bg-slate-800 transition-colors"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default GateDeliverablesModal;
