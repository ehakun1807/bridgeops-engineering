// ---------------------------------------------------------------------------
// DecisionLedgerTool — Per-project decision records log.
//
// Purpose: capture every meaningful engineering, design, supplier, regulatory,
// or commercial decision made during the project lifecycle with full context
// (what, who, why, risks, impact). Provides an audit-ready PDF Decision Register.
//
// The AI Analysis panel reads this collection as live signals — it runs
// decision drift detection (does a later change contradict an earlier decision?),
// risk memory (does the decision's stated risk now show up in PFMEA?), and
// impact awareness across the project readiness picture.
//
// Lifecycle: always editable. Status can be updated to Superseded or Reversed
// at any time — both are retained in the register for traceability (no delete
// on status change). Same editable posture as MeetingsTool.
//
// Persistence: `decisions` Firestore collection, one doc per decision.
// userId + projectId scoped, composite index (userId asc, projectId asc, dateMs desc).
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Scale,
  Plus,
  Loader2,
  ArrowLeft,
  Save,
  Trash2,
  RefreshCw,
  FileDown,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  MinusCircle
} from 'lucide-react';
import { db, auth } from './firebase.ts';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { buildDecisionRegisterPdf } from './utils/decisionRegisterPdf.ts';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type DecisionStatus   = 'active' | 'superseded' | 'reversed';
export type DecisionCategory = 'design' | 'process' | 'supplier' | 'regulatory' | 'commercial' | 'other';

export interface Decision {
  id: string;               // Firestore doc id ('' for unsaved)
  userId: string;
  projectId: string;
  dateMs: number;           // decision date — UTC midnight of chosen day
  title: string;            // short summary for list view (≤150 char, required)
  decisionMaker: string;    // who made it (≤100 char)
  category: DecisionCategory;
  gate?: string;            // gate at time of decision (optional)
  description: string;      // what was decided (≤600 char, required)
  rationale: string;        // why (≤600 char)
  relatedRisks: string;     // risk considerations at time of decision (≤500 char)
  impact: string;           // anticipated impact (≤500 char)
  status: DecisionStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TITLE_MAX        = 150;
const MAKER_MAX        = 100;
const DESCRIPTION_MAX  = 600;
const RATIONALE_MAX    = 600;
const RISKS_MAX        = 500;
const IMPACT_MAX       = 500;

export const CATEGORY_LABELS: Record<DecisionCategory, string> = {
  design:     'Design',
  process:    'Process',
  supplier:   'Supplier',
  regulatory: 'Regulatory',
  commercial: 'Commercial',
  other:      'Other'
};

export const CATEGORY_COLORS: Record<DecisionCategory, string> = {
  design:     'bg-indigo-50 text-indigo-700 border-indigo-200',
  process:    'bg-blue-50 text-blue-700 border-blue-200',
  supplier:   'bg-amber-50 text-amber-700 border-amber-200',
  regulatory: 'bg-rose-50 text-rose-700 border-rose-200',
  commercial: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  other:      'bg-slate-100 text-slate-600 border-slate-200'
};

const STATUS_LABELS: Record<DecisionStatus, string> = {
  active:     'Active',
  superseded: 'Superseded',
  reversed:   'Reversed'
};

const STATUS_COLORS: Record<DecisionStatus, string> = {
  active:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  superseded: 'bg-amber-50 text-amber-700 border-amber-200',
  reversed:   'bg-red-50 text-red-700 border-red-200'
};

const STATUS_ICONS: Record<DecisionStatus, React.ComponentType<{ size?: number; className?: string }>> = {
  active:     CheckCircle2,
  superseded: MinusCircle,
  reversed:   RotateCcw
};

const GATE_OPTIONS = ['CR', 'PDR', 'CDR', 'TRR', 'PRR', 'MP'];

// ---------------------------------------------------------------------------
// Date helpers (same UTC-midnight pattern as MeetingsTool)
// ---------------------------------------------------------------------------

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function msToISO(ms: number): string {
  if (!ms || !isFinite(ms)) return todayISO();
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isoToMs(v: string): number {
  if (!v) return Date.now();
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return Date.now();
  return Date.UTC(y, m - 1, d);
}

function fmtDate(ms: number): string {
  if (!ms || !isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const blankDecision = (projectId: string, userId: string): Decision => ({
  id: '',
  userId,
  projectId,
  dateMs: isoToMs(todayISO()),
  title: '',
  decisionMaker: '',
  category: 'design',
  gate: undefined,
  description: '',
  rationale: '',
  relatedRisks: '',
  impact: '',
  status: 'active'
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DecisionLedgerToolProps {
  projectId: string;
  projectName?: string;
  currentGate?: string;
  readOnly?: boolean;
}

type Mode = { kind: 'list' } | { kind: 'edit'; decision: Decision };

const DecisionLedgerTool: React.FC<DecisionLedgerToolProps> = ({
  projectId,
  projectName = 'Project',
  currentGate,
  readOnly = false
}) => {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [mode,      setMode]      = useState<Mode>({ kind: 'list' });
  const [exporting, setExporting] = useState(false);

  const uid = auth.currentUser?.uid ?? '';

  // ── Load ────────────────────────────────────────────────────────────────

  const load = async () => {
    if (!uid || !projectId) { setDecisions([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const snap = await getDocs(query(
        collection(db, 'decisions'),
        where('userId',    '==', uid),
        where('projectId', '==', projectId),
        orderBy('dateMs', 'desc')
      ));
      setDecisions(snap.docs.map(d => ({ ...d.data() as Omit<Decision, 'id'>, id: d.id })));
    } catch (e: any) {
      console.error('[DecisionLedgerTool] load failed', e);
      setError(e?.message ?? 'Failed to load decisions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [uid, projectId]); // eslint-disable-line

  // ── CRUD ────────────────────────────────────────────────────────────────

  const save = async (d: Decision) => {
    if (!uid) throw new Error('Not authenticated');
    const payload: Omit<Decision, 'id' | 'createdAt' | 'updatedAt'> & { updatedAt: any; createdAt?: any } = {
      userId:        uid,
      projectId,
      dateMs:        Number(d.dateMs) || isoToMs(todayISO()),
      title:         d.title.slice(0, TITLE_MAX).trim() || 'Untitled decision',
      decisionMaker: d.decisionMaker.slice(0, MAKER_MAX).trim(),
      category:      d.category,
      description:   d.description.slice(0, DESCRIPTION_MAX),
      rationale:     d.rationale.slice(0, RATIONALE_MAX),
      relatedRisks:  d.relatedRisks.slice(0, RISKS_MAX),
      impact:        d.impact.slice(0, IMPACT_MAX),
      status:        d.status,
      updatedAt:     serverTimestamp()
    };
    if (d.gate) payload.gate = d.gate; else delete (payload as any).gate;

    if (d.id) {
      await updateDoc(doc(db, 'decisions', d.id), payload);
    } else {
      await addDoc(collection(db, 'decisions'), { ...payload, createdAt: serverTimestamp() });
    }
    await load();
    setMode({ kind: 'list' });
  };

  const remove = async (d: Decision) => {
    if (!d.id) return;
    if (!confirm(`Delete "${d.title || 'this decision'}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'decisions', d.id));
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'Delete failed');
    }
  };

  // ── PDF Export ──────────────────────────────────────────────────────────

  const exportPdf = async () => {
    if (exporting || decisions.length === 0) return;
    setExporting(true);
    try {
      const bytes = await buildDecisionRegisterPdf(
        decisions.map(d => ({
          id:            d.id,
          dateMs:        d.dateMs,
          title:         d.title,
          decisionMaker: d.decisionMaker,
          category:      d.category,
          gate:          d.gate,
          description:   d.description,
          rationale:     d.rationale,
          relatedRisks:  d.relatedRisks,
          impact:        d.impact,
          status:        d.status
        })),
        projectName
      );
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${projectName.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}__decision_register.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.message ?? 'PDF export failed');
    } finally {
      setExporting(false);
    }
  };

  // ── Summary stats ────────────────────────────────────────────────────────

  const activeCount     = decisions.filter(d => d.status === 'active').length;
  const supersededCount = decisions.filter(d => d.status === 'superseded').length;
  const reversedCount   = decisions.filter(d => d.status === 'reversed').length;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-xl overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Scale size={20} className="text-slate-300" />
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/70 mb-1">
              Tool · Decision record &amp; drift tracking
            </p>
            <h3 className="text-lg font-black uppercase tracking-tight leading-tight">
              Decision Ledger
            </h3>
          </div>
        </div>

        {mode.kind === 'list' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="text-[10px] font-black uppercase tracking-widest text-white/70 hover:text-white transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Reload
            </button>
            {decisions.length > 0 && (
              <button
                type="button"
                onClick={exportPdf}
                disabled={exporting}
                title="Export PDF Decision Register"
                className="text-[10px] font-black uppercase tracking-widest text-indigo-300 hover:text-white border border-indigo-400/40 hover:border-white/40 px-3 py-1.5 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {exporting ? <Loader2 size={11} className="animate-spin" /> : <FileDown size={11} />}
                {exporting ? 'Exporting…' : 'PDF Register'}
              </button>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => uid && setMode({ kind: 'edit', decision: blankDecision(projectId, uid) })}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow"
              >
                <Plus size={12} /> New Decision
              </button>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <AnimatePresence mode="wait">
        {mode.kind === 'list' ? (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <DecisionList
              decisions={decisions}
              loading={loading}
              error={error}
              activeCount={activeCount}
              supersededCount={supersededCount}
              reversedCount={reversedCount}
              onOpen={(d) => setMode({ kind: 'edit', decision: d })}
              onDelete={remove}
              readOnly={readOnly}
            />
          </motion.div>
        ) : (
          <motion.div
            key="edit"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <DecisionForm
              initial={(mode as { kind: 'edit'; decision: Decision }).decision}
              currentGate={currentGate}
              onCancel={() => setMode({ kind: 'list' })}
              onSave={save}
              readOnly={readOnly}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DecisionLedgerTool;

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

interface DecisionListProps {
  decisions: Decision[];
  loading: boolean;
  error: string | null;
  activeCount: number;
  supersededCount: number;
  reversedCount: number;
  onOpen: (d: Decision) => void;
  onDelete: (d: Decision) => void;
  readOnly: boolean;
}

const DecisionList: React.FC<DecisionListProps> = ({
  decisions, loading, error,
  activeCount, supersededCount, reversedCount,
  onOpen, onDelete, readOnly
}) => {
  if (loading) {
    return (
      <div className="px-6 py-10 flex items-center justify-center text-slate-400 text-sm gap-2">
        <Loader2 size={14} className="animate-spin" /> Loading decisions…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-6 py-10 flex items-start gap-2 text-red-600 text-sm">
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (decisions.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <Scale size={28} className="mx-auto text-slate-300 mb-3" />
        <p className="text-sm text-slate-500 mb-1">No decisions recorded yet.</p>
        <p className="text-[11px] text-slate-400">
          Click <span className="font-semibold text-slate-600">New Decision</span> to capture the first one.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Summary strip */}
      {decisions.length > 0 && (
        <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/60 flex items-center gap-6">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            {decisions.length} decision{decisions.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-3">
            {activeCount > 0 && (
              <span className="text-[10px] font-bold text-emerald-700">
                {activeCount} active
              </span>
            )}
            {supersededCount > 0 && (
              <span className="text-[10px] font-bold text-amber-700">
                {supersededCount} superseded
              </span>
            )}
            {reversedCount > 0 && (
              <span className="text-[10px] font-bold text-red-700">
                {reversedCount} reversed
              </span>
            )}
          </div>
          {reversedCount > 0 && (
            <span className="ml-auto text-[9px] text-slate-400 italic">
              Reversed decisions are retained for traceability
            </span>
          )}
        </div>
      )}

      <ul className="divide-y divide-slate-100">
        {decisions.map((d) => {
          const StatusIcon = STATUS_ICONS[d.status];
          const catColor   = CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.other;
          const statColor  = STATUS_COLORS[d.status];
          const dimmed     = d.status !== 'active';

          return (
            <li
              key={d.id}
              className={`px-6 py-4 flex items-start gap-4 hover:bg-slate-50 transition-colors ${dimmed ? 'opacity-70' : ''}`}
            >
              <button type="button" onClick={() => onOpen(d)} className="flex-1 text-left min-w-0">
                {/* Row 1: date + chips */}
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500 tabular-nums">
                    {fmtDate(d.dateMs)}
                  </span>
                  {d.gate && (
                    <span className="border border-slate-200 bg-slate-100 text-slate-600 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">
                      {d.gate}
                    </span>
                  )}
                  <span className={`inline-flex items-center border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${catColor}`}>
                    {CATEGORY_LABELS[d.category]}
                  </span>
                  <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${statColor}`}>
                    <StatusIcon size={9} />
                    {STATUS_LABELS[d.status]}
                  </span>
                </div>
                {/* Row 2: title */}
                <p className={`text-sm font-bold truncate ${dimmed ? 'text-slate-500' : 'text-slate-900'}`}>
                  {d.title || 'Untitled decision'}
                </p>
                {/* Row 3: decision maker + impact preview */}
                <div className="flex items-start gap-3 mt-0.5">
                  {d.decisionMaker && (
                    <span className="text-[11px] text-slate-500 shrink-0">
                      By {d.decisionMaker}
                    </span>
                  )}
                  {d.impact && (
                    <span className="text-[11px] text-slate-400 line-clamp-1 italic">
                      Impact: {d.impact}
                    </span>
                  )}
                </div>
              </button>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onDelete(d)}
                  title="Delete decision"
                  className="text-slate-400 hover:text-red-600 transition-colors p-1 mt-0.5 shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
};

// ---------------------------------------------------------------------------
// Form view
// ---------------------------------------------------------------------------

interface DecisionFormProps {
  initial: Decision;
  currentGate?: string;
  onCancel: () => void;
  onSave: (d: Decision) => Promise<void>;
  readOnly: boolean;
}

const DecisionForm: React.FC<DecisionFormProps> = ({
  initial, currentGate, onCancel, onSave, readOnly
}) => {
  const [draft,     setDraft]     = useState<Decision>(() => ({
    ...initial,
    gate: initial.gate ?? currentGate ?? undefined
  }));
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isNew     = !initial.id;
  const canSave   = draft.title.trim().length > 0 && draft.description.trim().length > 0 && !readOnly && !saving;
  const set       = (patch: Partial<Decision>) => setDraft(p => ({ ...p, ...patch }));

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true); setSaveError(null);
    try { await onSave(draft); }
    catch (e: any) { setSaveError(e?.message ?? 'Save failed'); setSaving(false); }
  };

  return (
    <div className="px-6 py-5 space-y-5">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1"
        >
          <ArrowLeft size={12} /> Back to list
        </button>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          {isNew ? 'New decision' : 'Edit decision'}
        </span>
      </div>

      {/* Row 1: Date + Decision Maker + Gate + Category */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Date */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Date
          </label>
          <input
            type="date"
            value={msToISO(draft.dateMs)}
            onChange={e => set({ dateMs: isoToMs(e.target.value) })}
            disabled={readOnly}
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
          />
        </div>
        {/* Decision Maker */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Decision Maker
          </label>
          <input
            type="text"
            value={draft.decisionMaker}
            maxLength={MAKER_MAX}
            onChange={e => set({ decisionMaker: e.target.value })}
            disabled={readOnly}
            placeholder="Name or role"
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
          />
        </div>
        {/* Gate */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Gate at Decision
          </label>
          <select
            value={draft.gate ?? ''}
            onChange={e => set({ gate: e.target.value || undefined })}
            disabled={readOnly}
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 bg-white"
          >
            <option value="">— Not specified —</option>
            {GATE_OPTIONS.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        {/* Category */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Category
          </label>
          <select
            value={draft.category}
            onChange={e => set({ category: e.target.value as DecisionCategory })}
            disabled={readOnly}
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 bg-white"
          >
            {(Object.keys(CATEGORY_LABELS) as DecisionCategory[]).map(k => (
              <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Title + Status row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-3">
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Decision Title <span className="text-red-400 ml-0.5">*</span>
          </label>
          <input
            type="text"
            value={draft.title}
            maxLength={TITLE_MAX}
            onChange={e => set({ title: e.target.value })}
            disabled={readOnly}
            placeholder="Short, clear title — e.g. 'Selected TI CC2340R5 for BLE subsystem'"
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
          />
          <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
            {draft.title.length} / {TITLE_MAX}
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Status
          </label>
          <select
            value={draft.status}
            onChange={e => set({ status: e.target.value as DecisionStatus })}
            disabled={readOnly}
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 bg-white"
          >
            <option value="active">Active</option>
            <option value="superseded">Superseded</option>
            <option value="reversed">Reversed</option>
          </select>
          {draft.status !== 'active' && (
            <p className="text-[10px] text-amber-600 mt-1">
              {draft.status === 'superseded'
                ? 'Kept for record — replaced by a newer decision.'
                : 'Kept for traceability — decision was overturned.'}
            </p>
          )}
        </div>
      </div>

      {/* Description (What) */}
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
          What Was Decided <span className="text-red-400 ml-0.5">*</span>
        </label>
        <textarea
          value={draft.description}
          maxLength={DESCRIPTION_MAX}
          onChange={e => set({ description: e.target.value })}
          disabled={readOnly}
          rows={4}
          placeholder="Describe the decision clearly and specifically. Include any alternatives that were considered and rejected."
          className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 resize-y leading-relaxed"
        />
        <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
          {draft.description.length} / {DESCRIPTION_MAX}
        </div>
      </div>

      {/* Rationale (Why) */}
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
          Rationale — Why
        </label>
        <textarea
          value={draft.rationale}
          maxLength={RATIONALE_MAX}
          onChange={e => set({ rationale: e.target.value })}
          disabled={readOnly}
          rows={3}
          placeholder="Business case, technical constraints, data that drove the decision, trade-off analysis…"
          className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 resize-y leading-relaxed"
        />
        <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
          {draft.rationale.length} / {RATIONALE_MAX}
        </div>
      </div>

      {/* Risks + Impact (side by side) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Related Risks
          </label>
          <textarea
            value={draft.relatedRisks}
            maxLength={RISKS_MAX}
            onChange={e => set({ relatedRisks: e.target.value })}
            disabled={readOnly}
            rows={5}
            placeholder="Known risks at time of decision — supplier single-source, schedule dependency, regulatory uncertainty, reversibility cost…"
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 resize-y leading-relaxed"
          />
          <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
            {draft.relatedRisks.length} / {RISKS_MAX}
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Potential Impact
          </label>
          <textarea
            value={draft.impact}
            maxLength={IMPACT_MAX}
            onChange={e => set({ impact: e.target.value })}
            disabled={readOnly}
            rows={5}
            placeholder="Downstream effects — on schedule, cost, BOM, test plan, supplier qualification, other teams or workstreams…"
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 resize-y leading-relaxed"
          />
          <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
            {draft.impact.length} / {IMPACT_MAX}
          </div>
        </div>
      </div>

      {/* Save error */}
      {saveError && (
        <div className="border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-[12px] flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-4">
        <p className="text-[10px] text-slate-400">
          Title and "What was decided" are required. All other fields are optional but recommended.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors px-3 py-2"
          >
            Cancel
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-5 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {saving ? 'Saving…' : isNew ? 'Save Decision' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
