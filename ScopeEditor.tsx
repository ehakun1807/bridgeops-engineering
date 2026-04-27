// ---------------------------------------------------------------------------
// ScopeEditor — modal for toggling individual sub-items in/out of scope.
// Opens from General Info's Scope row. Commits on Save; Cancel discards.
// Receives the current disabledItemIds and emits a new array on save.
//
// Grouped by the 4 parent RAMP_GROUPS so the user can see the full picture
// of what they're enabling/disabling, with a per-group Select All / None.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ClipboardList, Loader2, Square, CheckSquare, X } from 'lucide-react';
import { RAMP_GROUPS, accentTokens } from './rampGroups';
import { PROJECT_TEMPLATES, disabledIdsForTemplate } from './templates';

interface ScopeEditorProps {
  open: boolean;
  disabledItemIds: string[];
  templateId?: string;
  saving?: boolean;
  onCancel: () => void;
  onSave: (nextDisabled: string[]) => void;
}

const ScopeEditor: React.FC<ScopeEditorProps> = ({
  open,
  disabledItemIds,
  templateId,
  saving,
  onCancel,
  onSave
}) => {
  // Local working copy so Cancel truly discards.
  const [draft, setDraft] = useState<Set<string>>(() => new Set(disabledItemIds));

  // Reseed whenever the modal re-opens.
  React.useEffect(() => {
    if (open) setDraft(new Set(disabledItemIds));
  }, [open, disabledItemIds]);

  const allIds = useMemo(
    () => RAMP_GROUPS.flatMap((g) => g.items.map((i) => i.id)),
    []
  );
  const totalCount = allIds.length;
  const enabledCount = totalCount - draft.size;

  const toggle = (id: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setGroupAll = (groupId: string, enable: boolean) => {
    const group = RAMP_GROUPS.find((g) => g.id === groupId);
    if (!group) return;
    setDraft((prev) => {
      const next = new Set(prev);
      group.items.forEach((i) => {
        if (enable) next.delete(i.id);
        else next.add(i.id);
      });
      return next;
    });
  };

  const applyTemplate = (tmplId: string) => {
    setDraft(new Set(disabledIdsForTemplate(tmplId)));
  };

  const handleSave = () => {
    onSave(Array.from(draft));
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="bg-white w-full max-w-3xl max-h-[85vh] rounded-sm shadow-2xl overflow-hidden flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scope-editor-title"
          >
            {/* Header */}
            <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <ClipboardList size={18} className="text-blue-400" />
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/70 mb-1">
                    Project Scope
                  </p>
                  <h3
                    id="scope-editor-title"
                    className="text-lg font-black uppercase tracking-tight leading-tight"
                  >
                    Edit Metric Scope
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={onCancel}
                className="text-white/60 hover:text-white transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Subhead + template shortcuts */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
              <p className="text-[11px] font-medium text-slate-600 leading-snug max-w-lg">
                Metrics marked <span className="font-black">N/A</span> are excluded from
                the rollup score. Check to enable, uncheck to mark N/A.
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Reset to:
                </span>
                {PROJECT_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t.id)}
                    className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 border transition-colors ${
                      t.id === templateId
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600'
                    }`}
                    title={t.description}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {RAMP_GROUPS.map((group) => {
                const tokens = accentTokens[group.accent];
                const groupEnabled = group.items.filter((i) => !draft.has(i.id)).length;
                const allOn = groupEnabled === group.items.length;
                const allOff = groupEnabled === 0;
                return (
                  <div key={group.id}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${tokens.bg}`} />
                        <h4 className="text-[11px] font-black uppercase tracking-tight text-slate-800">
                          {group.title}
                        </h4>
                        <span className="text-[10px] font-black tabular-nums text-slate-400">
                          · {groupEnabled}/{group.items.length}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setGroupAll(group.id, true)}
                          disabled={allOn}
                          className="text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-blue-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          All on
                        </button>
                        <span className="text-slate-300">·</span>
                        <button
                          type="button"
                          onClick={() => setGroupAll(group.id, false)}
                          disabled={allOff}
                          className="text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-red-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          All off
                        </button>
                      </div>
                    </div>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                      {group.items.map((item) => {
                        const isEnabled = !draft.has(item.id);
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => toggle(item.id)}
                              className="w-full flex items-start gap-2 text-left px-2 py-1.5 rounded-sm hover:bg-slate-50 transition-colors"
                            >
                              {isEnabled ? (
                                <CheckSquare
                                  size={14}
                                  className="flex-shrink-0 mt-0.5 text-emerald-600"
                                />
                              ) : (
                                <Square size={14} className="flex-shrink-0 mt-0.5 text-slate-400" />
                              )}
                              <span
                                className={`text-[11px] leading-snug ${
                                  isEnabled ? 'text-slate-700 font-medium' : 'text-slate-400'
                                }`}
                              >
                                {item.title}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-200 px-6 py-4 bg-white flex items-center justify-between flex-shrink-0">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                {enabledCount}/{totalCount} metrics enabled
              </span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={saving}
                  className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-50"
                >
                  {saving && <Loader2 size={12} className="animate-spin" />}
                  Apply Scope
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default ScopeEditor;
