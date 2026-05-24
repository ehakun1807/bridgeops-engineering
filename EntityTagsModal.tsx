// ---------------------------------------------------------------------------
// EntityTagsModal.tsx
//
// Manage user-defined entity aliases for org-level cross-project analysis.
// Lets the user declare "ACME Corp" = "Acme" = "ACME Electronics" so the AI
// connects them as the same supplier/component regardless of how they appear
// in risk flags or BOM descriptions across different projects.
//
// Storage: orgSettings/{userId}.entityAliases
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, Tag, Save, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { Firestore } from 'firebase/firestore';
import { loadEntityAliases, saveEntityAliases, EntityAliasMap } from './orgAliasesClient.ts';

interface EntityTagsModalProps {
  db: Firestore;
  userId: string;
  onClose: () => void;
}

const EntityTagsModal: React.FC<EntityTagsModalProps> = ({ db, userId, onClose }) => {
  const [aliases, setAliases]       = useState<EntityAliasMap>({});
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [saveOk, setSaveOk]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // New entity form
  const [newCanonical, setNewCanonical] = useState('');
  const [newAlias, setNewAlias]         = useState('');

  // Which entity's alias-input row is open
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [addAliasInput, setAddAliasInput] = useState<Record<string, string>>({});

  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadEntityAliases(db, userId).then((a) => {
      setAliases(a);
      setLoading(false);
    });
  }, [db, userId]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (overlayRef.current && e.target === overlayRef.current) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveEntityAliases(db, userId, aliases);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch (err: any) {
      setError(err?.message ?? 'Save failed — please retry.');
    } finally {
      setSaving(false);
    }
  };

  const addEntity = () => {
    const canonical = newCanonical.trim();
    if (!canonical) return;
    if (aliases[canonical]) {
      setError(`"${canonical}" already exists.`);
      return;
    }
    const updated = { ...aliases, [canonical]: [] };
    setAliases(updated);
    setNewCanonical('');
    setExpandedKey(canonical);
    setError(null);
  };

  const removeEntity = (canonical: string) => {
    const { [canonical]: _, ...rest } = aliases;
    setAliases(rest);
    if (expandedKey === canonical) setExpandedKey(null);
  };

  const addAlias = (canonical: string) => {
    const alias = (addAliasInput[canonical] ?? '').trim();
    if (!alias) return;
    const current = aliases[canonical] ?? [];
    if (current.includes(alias)) return;
    setAliases({ ...aliases, [canonical]: [...current, alias] });
    setAddAliasInput({ ...addAliasInput, [canonical]: '' });
  };

  const removeAlias = (canonical: string, alias: string) => {
    const updated = (aliases[canonical] ?? []).filter((a) => a !== alias);
    setAliases({ ...aliases, [canonical]: updated });
  };

  const canonicalKeys = Object.keys(aliases).sort((a, b) => a.localeCompare(b));

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.15 }}
        className="bg-white rounded-sm shadow-2xl w-full max-w-xl flex flex-col max-h-[80vh]"
        style={{ minHeight: 320 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Tag size={16} className="text-indigo-500" />
            <h2 className="text-[13px] font-black uppercase tracking-widest text-slate-900">Entity Tags</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Map alternate names to a canonical entity so the AI recognizes them as the same supplier, component, or partner across projects. E.g. canonical <span className="font-semibold text-slate-700">"ACME Corp"</span> with aliases <span className="font-semibold text-slate-700">"Acme"</span>, <span className="font-semibold text-slate-700">"ACME Electronics"</span>.
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-[12px] py-6 justify-center">
              <Loader2 size={14} className="animate-spin" /> Loading aliases…
            </div>
          ) : (
            <>
              {/* Add new entity row */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCanonical}
                  onChange={(e) => setNewCanonical(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addEntity(); }}
                  placeholder="Canonical name (e.g. ACME Corp)"
                  className="flex-1 border border-slate-200 rounded-sm px-3 py-2 text-[12px] placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
                  maxLength={100}
                />
                <button
                  onClick={addEntity}
                  disabled={!newCanonical.trim()}
                  className="flex items-center gap-1 bg-indigo-600 text-white px-3 py-2 rounded-sm text-[11px] font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                >
                  <Plus size={12} /> Add
                </button>
              </div>

              {/* Entity list */}
              {canonicalKeys.length === 0 ? (
                <p className="text-[12px] text-slate-400 text-center py-6">No entities defined yet — add one above.</p>
              ) : (
                <div className="space-y-2">
                  {canonicalKeys.map((canonical) => {
                    const aliasList = aliases[canonical] ?? [];
                    const isExpanded = expandedKey === canonical;
                    return (
                      <div key={canonical} className="border border-slate-100 rounded-sm">
                        {/* Canonical row */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50">
                          <button
                            onClick={() => setExpandedKey(isExpanded ? null : canonical)}
                            className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                          >
                            {isExpanded
                              ? <ChevronDown size={12} className="text-slate-400 shrink-0" />
                              : <ChevronRight size={12} className="text-slate-400 shrink-0" />
                            }
                            <span className="text-[12px] font-semibold text-slate-800 truncate">{canonical}</span>
                            <span className="text-[10px] text-slate-400 shrink-0">
                              {aliasList.length === 0 ? 'no aliases' : `${aliasList.length} alias${aliasList.length > 1 ? 'es' : ''}`}
                            </span>
                          </button>
                          <button
                            onClick={() => removeEntity(canonical)}
                            className="text-slate-300 hover:text-rose-500 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>

                        {/* Expanded: alias chips + add input */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.15 }}
                              className="overflow-hidden"
                            >
                              <div className="px-3 py-2 space-y-2 border-t border-slate-100">
                                {/* Alias chips */}
                                <div className="flex flex-wrap gap-1.5">
                                  {aliasList.map((alias) => (
                                    <span
                                      key={alias}
                                      className="flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] px-2 py-0.5 rounded-full"
                                    >
                                      {alias}
                                      <button onClick={() => removeAlias(canonical, alias)} className="hover:text-rose-500 transition-colors">
                                        <X size={9} />
                                      </button>
                                    </span>
                                  ))}
                                  {aliasList.length === 0 && (
                                    <span className="text-[11px] text-slate-400 italic">No aliases yet</span>
                                  )}
                                </div>
                                {/* Add alias input */}
                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    value={addAliasInput[canonical] ?? ''}
                                    onChange={(e) => setAddAliasInput({ ...addAliasInput, [canonical]: e.target.value })}
                                    onKeyDown={(e) => { if (e.key === 'Enter') addAlias(canonical); }}
                                    placeholder="Add alias (e.g. Acme, ACME Inc)"
                                    className="flex-1 border border-slate-200 rounded-sm px-2 py-1.5 text-[11px] placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
                                    maxLength={100}
                                  />
                                  <button
                                    onClick={() => addAlias(canonical)}
                                    disabled={!(addAliasInput[canonical] ?? '').trim()}
                                    className="flex items-center gap-1 border border-indigo-300 text-indigo-600 px-2 py-1.5 rounded-sm text-[10px] font-black uppercase tracking-widest hover:bg-indigo-50 disabled:opacity-40 transition-colors"
                                  >
                                    <Plus size={10} />
                                  </button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-3">
          <div className="flex-1">
            {error && <p className="text-[11px] text-rose-600">{error}</p>}
            {saveOk && <p className="text-[11px] text-emerald-600">Saved — aliases will apply on next Org Insights run.</p>}
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 text-[11px] font-black uppercase tracking-widest hover:text-slate-800 transition-colors px-3 py-2"
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-sm text-[11px] font-black uppercase tracking-widest hover:bg-slate-700 disabled:opacity-40 transition-colors"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save Aliases
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default EntityTagsModal;
