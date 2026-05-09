// ---------------------------------------------------------------------------
// PFMEATool — Per-project Process Failure Mode and Effects Analysis.
// Lives next to Meetings in the ProjectDeepDive utility tab strip.
//
// Purpose: capture process risks for a project's manufacturing / assembly /
// service process, score them on Severity / Occurrence / Detection, compute
// RPN automatically, and surface the AIAG-VDA 2019 Action Priority (AP) so
// teams can prioritise mitigation work using the current standard.
//
// Standard alignment: AIAG-VDA 2019 PFMEA (current "latest" — replaces the
// AIAG 4th edition + VDA 4 from 2008). Scoring scales (S/O/D) follow the
// AIAG-VDA 2019 anchors. The AP lookup here is a published approximation of
// the standard's three-dimensional table — close enough for prioritisation,
// but teams with formal compliance needs should overlay their own AP rules.
//
// Lifecycle: always editable (same posture as MeetingsTool — no draft /
// completed lock). Re-opening an FMEA, adding revised S/O/D, and re-saving
// is the normal review-of-action-effectiveness flow.
//
// Persistence: `pfmeas` Firestore collection, one doc per FMEA. userId +
// projectId scoped, rules mirror the meetings pattern.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Loader2,
  ArrowLeft,
  Save,
  Trash2,
  RefreshCw,
  Calendar as CalendarIcon,
  AlertTriangle,
  Users,
  ShieldAlert,
  Info,
  BarChart3,
  LayoutGrid,
  Copy
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

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface RiskLine {
  id: string;                  // local id (uuid-ish, stable across renders)
  processStep: string;
  failureMode: string;
  failureEffect: string;
  severity: number;            // 1–10
  cause: string;
  occurrence: number;          // 1–10
  controls: string;
  detection: number;           // 1–10
  recommendedAction: string;
  responsible: string;
  actionsTaken: string;
  // Optional revised scores after action close-out. When all three are set
  // we surface a "Revised" RPN/AP next to the original. Stored as undefined
  // until the user fills them in.
  revisedSeverity?: number;
  revisedOccurrence?: number;
  revisedDetection?: number;
}

export interface PFMEA {
  id: string;                  // Firestore doc id ('' for unsaved)
  userId: string;
  projectId: string;
  dateMs: number;              // FMEA review date (UTC midnight)
  title: string;               // process under analysis (e.g., "Final Assembly")
  scope: string;               // brief description / boundary
  participants: string;        // comma-separated names (mirrors MeetingsTool)
  risks: RiskLine[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

const TITLE_MAX = 200;
const SCOPE_MAX = 500;
const PARTICIPANTS_MAX = 500;
const RISK_TEXT_MAX = 300;     // each text cell on a risk row
const MAX_RISKS = 100;

// ---------------------------------------------------------------------------
// Scoring scales — AIAG-VDA 2019 anchors. Each entry is keyed by 1..10 and
// carries a short label + a one-liner the tooltip shows when the user hovers
// the score selector. Kept industry-neutral so SOPs across automotive /
// medical / aerospace / electronics read fluently.
// ---------------------------------------------------------------------------

interface ScaleAnchor {
  score: number;
  label: string;
  detail: string;
}

const SEVERITY_SCALE: ScaleAnchor[] = [
  { score: 10, label: 'Hazardous (no warning)', detail: 'Endangers operator or end user without warning. Violates regulation.' },
  { score: 9, label: 'Hazardous (with warning)', detail: 'Endangers operator or end user but a warning precedes failure. May violate regulation.' },
  { score: 8, label: 'Very high', detail: 'Loss of primary function. Product unusable; customer very dissatisfied.' },
  { score: 7, label: 'High', detail: 'Reduced primary function. Product operable but degraded; high customer dissatisfaction.' },
  { score: 6, label: 'Moderate', detail: 'Loss of secondary function. Customer experiences discomfort / complains.' },
  { score: 5, label: 'Low', detail: 'Degraded secondary function. Customer notices minor performance loss.' },
  { score: 4, label: 'Very low', detail: 'Fit / finish / minor non-conformance. Most customers notice.' },
  { score: 3, label: 'Minor', detail: 'Cosmetic or non-functional defect. Average customer notices.' },
  { score: 2, label: 'Very minor', detail: 'Slight effect; only discriminating customers notice.' },
  { score: 1, label: 'None', detail: 'No discernible effect on the customer or process.' }
];

const OCCURRENCE_SCALE: ScaleAnchor[] = [
  { score: 10, label: 'Very high', detail: 'Failure is almost inevitable. ≥ 1 in 2 (≥ 100,000 ppm).' },
  { score: 9, label: 'Very high', detail: 'Failures are persistent. ~1 in 3 (~50,000 ppm).' },
  { score: 8, label: 'High', detail: 'Repeated failures. ~1 in 8 (~20,000 ppm).' },
  { score: 7, label: 'High', detail: 'Frequent failures. ~1 in 20 (~10,000 ppm).' },
  { score: 6, label: 'Moderate', detail: 'Occasional failures. ~1 in 80 (~5,000 ppm).' },
  { score: 5, label: 'Moderate', detail: 'Few failures. ~1 in 400 (~2,000 ppm).' },
  { score: 4, label: 'Moderate', detail: 'Isolated failures. ~1 in 2,000 (~500 ppm).' },
  { score: 3, label: 'Low', detail: 'Process in statistical control. ~1 in 15,000 (~50 ppm).' },
  { score: 2, label: 'Low', detail: 'Process in statistical control. ~1 in 150,000 (~5 ppm).' },
  { score: 1, label: 'Very low', detail: 'Failure unlikely. < 1 in 1,500,000 (< 0.5 ppm).' }
];

const DETECTION_SCALE: ScaleAnchor[] = [
  { score: 10, label: 'Almost impossible', detail: 'No control exists, or controls cannot detect the failure.' },
  { score: 9, label: 'Very remote', detail: 'Controls have very poor chance of detection.' },
  { score: 8, label: 'Remote', detail: 'Controls have poor chance of detection.' },
  { score: 7, label: 'Very low', detail: 'Detection is unlikely; controls weak.' },
  { score: 6, label: 'Low', detail: 'Indirect or random checks; detection chance is low.' },
  { score: 5, label: 'Moderate', detail: 'Visual / manual inspection at the workstation.' },
  { score: 4, label: 'Moderately high', detail: 'In-process gauging / SPC after the operation.' },
  { score: 3, label: 'High', detail: 'Mistake-proofing (poka-yoke) catches most defects in-process.' },
  { score: 2, label: 'Very high', detail: 'Mistake-proofing catches the defect; cannot pass downstream.' },
  { score: 1, label: 'Almost certain', detail: 'Defect cannot physically occur given the controls (e.g. fixture geometry).' }
];

// ---------------------------------------------------------------------------
// Risk math — RPN, AP, tier classification.
// ---------------------------------------------------------------------------

export function computeRPN(s: number, o: number, d: number): number {
  if (!isFinite(s) || !isFinite(o) || !isFinite(d)) return 0;
  return Math.max(0, Math.min(10, s)) * Math.max(0, Math.min(10, o)) * Math.max(0, Math.min(10, d));
}

export type RPNTier = 'low' | 'medium' | 'high';

// Conservative defaults; many companies tune these to their own risk policy.
// <40 Low (green) — typical "monitor" threshold
// 40–100 Medium (amber) — review and consider mitigation
// >100 High (red) — action required
export function rpnTier(rpn: number): RPNTier {
  if (rpn > 100) return 'high';
  if (rpn >= 40) return 'medium';
  return 'low';
}

export type ActionPriority = 'H' | 'M' | 'L';

// AIAG-VDA 2019 Action Priority — published simplification of the standard's
// 3D lookup. Kept conservative: when in doubt, escalate.
export function actionPriority(s: number, o: number, d: number): ActionPriority {
  // Hazardous severity: anything detectable matters.
  if (s >= 9) {
    if (o >= 6) return 'H';
    if (o >= 4 && d >= 4) return 'H';
    if (o >= 2 && d >= 6) return 'H';
    if (o >= 2 || d >= 5) return 'M';
    return 'L';
  }
  // High severity (loss of primary function / customer-very-dissatisfied):
  if (s >= 7) {
    if (o >= 6 && d >= 4) return 'H';
    if (o >= 4 && d >= 5) return 'H';
    if (o >= 4 || (o >= 2 && d >= 5)) return 'M';
    if (d >= 7) return 'M';
    return 'L';
  }
  // Moderate severity (loss of secondary function):
  if (s >= 4) {
    if (o >= 8 && d >= 5) return 'H';
    if (o >= 6 && d >= 4) return 'M';
    if (o >= 4 || d >= 6) return 'M';
    return 'L';
  }
  // Low severity (cosmetic / minor):
  if (s >= 2) {
    if (o >= 8 && d >= 6) return 'M';
    return 'L';
  }
  // No effect:
  return 'L';
}

const TIER_CHIP: Record<RPNTier, { bg: string; text: string; ring: string; label: string }> = {
  high:   { bg: 'bg-rose-100',    text: 'text-rose-800',    ring: 'ring-rose-300',    label: 'High' },
  medium: { bg: 'bg-amber-100',   text: 'text-amber-800',   ring: 'ring-amber-300',   label: 'Medium' },
  low:    { bg: 'bg-emerald-100', text: 'text-emerald-800', ring: 'ring-emerald-300', label: 'Low' }
};

const AP_CHIP: Record<ActionPriority, { bg: string; text: string; label: string }> = {
  H: { bg: 'bg-rose-600',    text: 'text-white', label: 'AP: High' },
  M: { bg: 'bg-amber-500',   text: 'text-white', label: 'AP: Medium' },
  L: { bg: 'bg-emerald-600', text: 'text-white', label: 'AP: Low' }
};

// ---------------------------------------------------------------------------
// Date helpers — same UTC-anchored pattern as MeetingsTool.
// ---------------------------------------------------------------------------

function todayDateInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateInputValueFromMs(ms: number): string {
  if (!ms || !isFinite(ms)) return todayDateInputValue();
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function msFromDateInputValue(v: string): number {
  if (!v) return Date.now();
  const [y, m, d] = v.split('-').map((p) => Number(p));
  if (!y || !m || !d) return Date.now();
  return Date.UTC(y, m - 1, d);
}

function formatDate(ms: number): string {
  if (!ms || !isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
}

// Stable-ish local ids for risk rows. Firestore allocates the parent doc id;
// rows are embedded so they need their own keys for React reconciliation.
function newRiskId(): string {
  return `r_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

const newRisk = (): RiskLine => ({
  id: newRiskId(),
  processStep: '',
  failureMode: '',
  failureEffect: '',
  severity: 5,
  cause: '',
  occurrence: 5,
  controls: '',
  detection: 5,
  recommendedAction: '',
  responsible: '',
  actionsTaken: ''
});

const newPFMEA = (projectId: string, userId: string): PFMEA => ({
  id: '',
  userId,
  projectId,
  dateMs: msFromDateInputValue(todayDateInputValue()),
  title: '',
  scope: '',
  participants: '',
  risks: [newRisk()]
});

// ---------------------------------------------------------------------------
// Component shell — list ↔ form
// ---------------------------------------------------------------------------

interface PFMEAToolProps {
  projectId: string;
  readOnly?: boolean;
}

type Mode = { kind: 'list' } | { kind: 'edit'; pfmea: PFMEA };

const PFMEATool: React.FC<PFMEAToolProps> = ({ projectId, readOnly = false }) => {
  const [items, setItems] = useState<PFMEA[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  const uid = auth.currentUser?.uid ?? '';

  const load = async () => {
    if (!uid || !projectId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = query(
        collection(db, 'pfmeas'),
        where('userId', '==', uid),
        where('projectId', '==', projectId),
        orderBy('dateMs', 'desc')
      );
      const snap = await getDocs(q);
      const rows: PFMEA[] = snap.docs.map((d) => {
        const data = d.data() as Omit<PFMEA, 'id'>;
        // Defensive: rows might be missing on old / partial docs
        return { ...data, id: d.id, risks: Array.isArray((data as any).risks) ? (data as any).risks : [] };
      });
      setItems(rows);
    } catch (e: any) {
      console.error('[PFMEATool] load failed', e);
      setError(e?.message || 'Failed to load PFMEAs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, projectId]);

  const startNew = () => {
    if (!uid) return;
    setMode({ kind: 'edit', pfmea: newPFMEA(projectId, uid) });
  };

  const open = (p: PFMEA) => setMode({ kind: 'edit', pfmea: p });
  const cancelEdit = () => setMode({ kind: 'list' });

  const save = async (p: PFMEA) => {
    if (!uid) throw new Error('Not authenticated');
    // Sanitise embedded risks before write so rules see well-shaped data.
    const cleanRisks: RiskLine[] = (p.risks || []).slice(0, MAX_RISKS).map((r) => ({
      id: r.id || newRiskId(),
      processStep: (r.processStep || '').slice(0, RISK_TEXT_MAX),
      failureMode: (r.failureMode || '').slice(0, RISK_TEXT_MAX),
      failureEffect: (r.failureEffect || '').slice(0, RISK_TEXT_MAX),
      severity: clamp1to10(r.severity, 5),
      cause: (r.cause || '').slice(0, RISK_TEXT_MAX),
      occurrence: clamp1to10(r.occurrence, 5),
      controls: (r.controls || '').slice(0, RISK_TEXT_MAX),
      detection: clamp1to10(r.detection, 5),
      recommendedAction: (r.recommendedAction || '').slice(0, RISK_TEXT_MAX),
      responsible: (r.responsible || '').slice(0, RISK_TEXT_MAX),
      actionsTaken: (r.actionsTaken || '').slice(0, RISK_TEXT_MAX),
      ...(typeof r.revisedSeverity === 'number' ? { revisedSeverity: clamp1to10(r.revisedSeverity, 5) } : {}),
      ...(typeof r.revisedOccurrence === 'number' ? { revisedOccurrence: clamp1to10(r.revisedOccurrence, 5) } : {}),
      ...(typeof r.revisedDetection === 'number' ? { revisedDetection: clamp1to10(r.revisedDetection, 5) } : {})
    }));

    const payload = {
      userId: uid,
      projectId,
      dateMs: Number(p.dateMs) || msFromDateInputValue(todayDateInputValue()),
      title: p.title.slice(0, TITLE_MAX).trim() || 'Untitled PFMEA',
      scope: p.scope.slice(0, SCOPE_MAX),
      participants: p.participants.slice(0, PARTICIPANTS_MAX),
      risks: cleanRisks,
      updatedAt: serverTimestamp()
    };

    if (p.id) {
      await updateDoc(doc(db, 'pfmeas', p.id), payload);
    } else {
      await addDoc(collection(db, 'pfmeas'), {
        ...payload,
        createdAt: serverTimestamp()
      });
    }
    await load();
    setMode({ kind: 'list' });
  };

  const remove = async (p: PFMEA) => {
    if (!p.id) return;
    if (!confirm(`Delete "${p.title || 'this PFMEA'}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'pfmeas', p.id));
      await load();
    } catch (e: any) {
      console.error('[PFMEATool] delete failed', e);
      alert(e?.message || 'Delete failed');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-xl overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldAlert size={20} className="text-rose-300" />
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/70 mb-1">
              Tool · AIAG-VDA 2019
            </p>
            <h3 className="text-lg font-black uppercase tracking-tight leading-tight">
              PFMEA — Process Risk Analysis
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
            {!readOnly && (
              <button
                type="button"
                onClick={startNew}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow"
              >
                <Plus size={12} /> New PFMEA
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
            <PFMEAList
              items={items}
              loading={loading}
              error={error}
              onOpen={open}
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
            <PFMEAForm
              initial={mode.pfmea}
              onCancel={cancelEdit}
              onSave={save}
              readOnly={readOnly}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PFMEATool;

function clamp1to10(n: any, dflt: number): number {
  const v = Number(n);
  if (!isFinite(v)) return dflt;
  return Math.max(1, Math.min(10, Math.round(v)));
}

// ---------------------------------------------------------------------------
// List view — one card per saved PFMEA, summarising risk count + max RPN.
// ---------------------------------------------------------------------------

interface PFMEAListProps {
  items: PFMEA[];
  loading: boolean;
  error: string | null;
  onOpen: (p: PFMEA) => void;
  onDelete: (p: PFMEA) => void;
  readOnly: boolean;
}

const PFMEAList: React.FC<PFMEAListProps> = ({
  items, loading, error, onOpen, onDelete, readOnly
}) => {
  if (loading) {
    return (
      <div className="px-6 py-10 flex items-center justify-center text-slate-400 text-sm gap-2">
        <Loader2 size={14} className="animate-spin" /> Loading PFMEAs…
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
  if (items.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <ShieldAlert size={28} className="mx-auto text-slate-300 mb-3" />
        <p className="text-sm text-slate-500 mb-1">No PFMEAs yet for this project.</p>
        <p className="text-[11px] text-slate-400">
          Click <span className="font-semibold text-slate-600">New PFMEA</span> to start one.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((p) => {
        const risks = p.risks || [];
        const rpns = risks.map((r) => computeRPN(r.severity, r.occurrence, r.detection));
        const maxRpn = rpns.length ? Math.max(...rpns) : 0;
        const tier = rpnTier(maxRpn);
        const tierTok = TIER_CHIP[tier];
        const highCount = rpns.filter((v) => rpnTier(v) === 'high').length;

        return (
          <li key={p.id} className="px-6 py-4 flex items-start gap-4 hover:bg-slate-50 transition-colors">
            <button
              type="button"
              onClick={() => onOpen(p)}
              className="flex-1 text-left"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500 tabular-nums">
                  {formatDate(p.dateMs)}
                </span>
                <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${tierTok.bg} ${tierTok.text} border-transparent`}>
                  Max RPN {maxRpn || '—'} · {tierTok.label}
                </span>
                <span className="inline-flex items-center border border-slate-200 bg-slate-50 text-slate-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">
                  {risks.length} {risks.length === 1 ? 'Risk' : 'Risks'}
                </span>
                {highCount > 0 && (
                  <span className="inline-flex items-center border border-rose-200 bg-rose-50 text-rose-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">
                    {highCount} High
                  </span>
                )}
              </div>
              <p className="text-sm font-bold text-slate-900 mt-1 truncate">
                {p.title || 'Untitled PFMEA'}
              </p>
              {p.participants && (
                <p className="text-[11px] text-slate-500 mt-0.5 flex items-start gap-1">
                  <Users size={11} className="mt-0.5 flex-shrink-0" />
                  <span className="line-clamp-1">{p.participants}</span>
                </p>
              )}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onDelete(p)}
                title="Delete PFMEA"
                className="text-slate-400 hover:text-red-600 transition-colors p-1"
              >
                <Trash2 size={14} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
};

// ---------------------------------------------------------------------------
// Form view — header fields + risk table + diagrams + save bar.
// ---------------------------------------------------------------------------

interface PFMEAFormProps {
  initial: PFMEA;
  onCancel: () => void;
  onSave: (p: PFMEA) => Promise<void>;
  readOnly: boolean;
}

const PFMEAForm: React.FC<PFMEAFormProps> = ({ initial, onCancel, onSave, readOnly }) => {
  const [draft, setDraft] = useState<PFMEA>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isNew = !initial.id;
  const titleTrimmed = draft.title.trim();
  const canSave = titleTrimmed.length > 0 && !readOnly && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
    } catch (e: any) {
      console.error('[PFMEATool] save failed', e);
      setSaveError(e?.message || 'Save failed');
      setSaving(false);
    }
  };

  const updateRisk = (idx: number, patch: Partial<RiskLine>) => {
    setDraft((prev) => {
      const next = [...prev.risks];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, risks: next };
    });
  };
  const addRisk = () => {
    setDraft((prev) => ({ ...prev, risks: [...prev.risks, newRisk()] }));
  };
  const duplicateRisk = (idx: number) => {
    setDraft((prev) => {
      const src = prev.risks[idx];
      const dup: RiskLine = { ...src, id: newRiskId() };
      const next = [...prev.risks];
      next.splice(idx + 1, 0, dup);
      return { ...prev, risks: next };
    });
  };
  const deleteRisk = (idx: number) => {
    setDraft((prev) => {
      if (prev.risks.length <= 1) {
        // Keep at least one row so the table doesn't disappear.
        return { ...prev, risks: [newRisk()] };
      }
      const next = [...prev.risks];
      next.splice(idx, 1);
      return { ...prev, risks: next };
    });
  };

  // Aggregate stats for the diagrams + summary chips.
  const stats = useMemo(() => {
    const rpns = draft.risks.map((r) => computeRPN(r.severity, r.occurrence, r.detection));
    const tiers = rpns.map((v) => rpnTier(v));
    return {
      total: draft.risks.length,
      maxRpn: rpns.length ? Math.max(...rpns) : 0,
      meanRpn: rpns.length ? Math.round(rpns.reduce((a, b) => a + b, 0) / rpns.length) : 0,
      high: tiers.filter((t) => t === 'high').length,
      medium: tiers.filter((t) => t === 'medium').length,
      low: tiers.filter((t) => t === 'low').length
    };
  }, [draft.risks]);

  return (
    <div className="px-6 py-5 space-y-6">
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
          {isNew ? 'New PFMEA' : 'Edit PFMEA'}
        </span>
      </div>

      {/* Header fields — Title / Date / Participants / Scope */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Process under analysis
          </label>
          <input
            type="text"
            value={draft.title}
            maxLength={TITLE_MAX}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            disabled={readOnly}
            placeholder="e.g. Final assembly — pump module"
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50"
          />
          <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
            {draft.title.length} / {TITLE_MAX}
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            <CalendarIcon size={11} className="inline-block mr-1 mb-0.5" /> Review date
          </label>
          <input
            type="date"
            value={dateInputValueFromMs(draft.dateMs)}
            onChange={(e) => setDraft({ ...draft, dateMs: msFromDateInputValue(e.target.value) })}
            disabled={readOnly}
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            <Users size={11} className="inline-block mr-1 mb-0.5" /> Participants
          </label>
          <textarea
            value={draft.participants}
            maxLength={PARTICIPANTS_MAX}
            onChange={(e) => setDraft({ ...draft, participants: e.target.value })}
            disabled={readOnly}
            rows={2}
            placeholder="Comma-separated: facilitator, process owner, quality, manufacturing, design, supplier"
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50 resize-y"
          />
          <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
            {draft.participants.length} / {PARTICIPANTS_MAX}
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Scope / Boundaries
          </label>
          <textarea
            value={draft.scope}
            maxLength={SCOPE_MAX}
            onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
            disabled={readOnly}
            rows={2}
            placeholder="What's in / out of scope (e.g. station 30–80; excludes incoming inspection)"
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50 resize-y"
          />
          <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
            {draft.scope.length} / {SCOPE_MAX}
          </div>
        </div>
      </div>

      {/* Summary chip strip */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Summary:</span>
        <SummaryChip label="Risks" value={stats.total} tone="slate" />
        <SummaryChip label="Max RPN" value={stats.maxRpn || '—'} tone={stats.maxRpn > 100 ? 'rose' : stats.maxRpn >= 40 ? 'amber' : 'emerald'} />
        <SummaryChip label="Mean RPN" value={stats.meanRpn || '—'} tone="slate" />
        <SummaryChip label="High" value={stats.high} tone="rose" />
        <SummaryChip label="Medium" value={stats.medium} tone="amber" />
        <SummaryChip label="Low" value={stats.low} tone="emerald" />
      </div>

      {/* Risk table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
            Risk lines
            <span className="text-[10px] font-bold text-slate-400 normal-case tracking-normal">
              ({draft.risks.length} / {MAX_RISKS})
            </span>
          </h4>
          {!readOnly && draft.risks.length < MAX_RISKS && (
            <button
              type="button"
              onClick={addRisk}
              className="text-[10px] font-black uppercase tracking-widest text-blue-700 hover:text-blue-900 transition-colors flex items-center gap-1"
            >
              <Plus size={12} /> Add risk
            </button>
          )}
        </div>

        <div className="space-y-3">
          {draft.risks.map((r, idx) => (
            <RiskCard
              key={r.id}
              index={idx}
              risk={r}
              readOnly={readOnly}
              onChange={(patch) => updateRisk(idx, patch)}
              onDuplicate={() => duplicateRisk(idx)}
              onDelete={() => deleteRisk(idx)}
            />
          ))}
        </div>
      </div>

      {/* Diagrams */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DiagramCard
          title="Risk Heatmap"
          subtitle="Severity × Occurrence — dot size scales with Detection"
          icon={LayoutGrid}
        >
          <Heatmap risks={draft.risks} />
        </DiagramCard>
        <DiagramCard
          title="Pareto · Top 10 by RPN"
          subtitle="Tackle the longest bars first"
          icon={BarChart3}
        >
          <Pareto risks={draft.risks} />
        </DiagramCard>
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
        <p className="text-[10px] text-slate-400 max-w-md">
          Action Priority follows the AIAG-VDA 2019 standard (published approximation).
          RPN tiers: Low &lt; 40, Medium 40–100, High &gt; 100.
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
              className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {saving ? 'Saving…' : isNew ? 'Save PFMEA' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Risk card — one editable risk line.
// ---------------------------------------------------------------------------

interface RiskCardProps {
  index: number;
  risk: RiskLine;
  readOnly: boolean;
  onChange: (patch: Partial<RiskLine>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const RiskCard: React.FC<RiskCardProps> = ({ index, risk, readOnly, onChange, onDuplicate, onDelete }) => {
  const rpn = computeRPN(risk.severity, risk.occurrence, risk.detection);
  const tier = rpnTier(rpn);
  const tierTok = TIER_CHIP[tier];
  const ap = actionPriority(risk.severity, risk.occurrence, risk.detection);
  const apTok = AP_CHIP[ap];

  const hasRevised =
    typeof risk.revisedSeverity === 'number' &&
    typeof risk.revisedOccurrence === 'number' &&
    typeof risk.revisedDetection === 'number';
  const revisedRPN = hasRevised
    ? computeRPN(risk.revisedSeverity!, risk.revisedOccurrence!, risk.revisedDetection!)
    : 0;
  const revisedTier = hasRevised ? rpnTier(revisedRPN) : 'low';
  const revisedAP = hasRevised
    ? actionPriority(risk.revisedSeverity!, risk.revisedOccurrence!, risk.revisedDetection!)
    : 'L';

  const [showRevised, setShowRevised] = useState<boolean>(hasRevised);

  return (
    <div className={`border rounded-sm bg-white ${tier === 'high' ? 'border-rose-300' : tier === 'medium' ? 'border-amber-300' : 'border-slate-200'}`}>
      {/* Top bar — index, scores, AP, RPN, actions */}
      <div className={`flex items-center justify-between flex-wrap gap-2 px-3 py-2 border-b ${tier === 'high' ? 'border-rose-200 bg-rose-50/40' : tier === 'medium' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-100 bg-slate-50/40'}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Risk #{index + 1}
          </span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ring-1 ring-inset ${tierTok.bg} ${tierTok.text} ${tierTok.ring}`}>
            RPN {rpn} · {tierTok.label}
          </span>
          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${apTok.bg} ${apTok.text}`}>
            {apTok.label}
          </span>
          {hasRevised && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white">
              Revised RPN {revisedRPN} · {TIER_CHIP[revisedTier].label}
              <span className="opacity-60">·</span>
              {AP_CHIP[revisedAP].label}
            </span>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onDuplicate}
              title="Duplicate row"
              className="text-slate-400 hover:text-slate-700 p-1"
            >
              <Copy size={13} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              title="Delete row"
              className="text-slate-400 hover:text-red-600 p-1"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Identification: process step / failure mode / failure effect */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 border-b border-slate-100">
        <RiskInput
          label="Process step / input"
          value={risk.processStep}
          placeholder="What process step / change / feature is under investigation?"
          onChange={(v) => onChange({ processStep: v })}
          readOnly={readOnly}
          rows={2}
        />
        <RiskInput
          label="Potential failure mode"
          value={risk.failureMode}
          placeholder="In what way could the step go wrong?"
          onChange={(v) => onChange({ failureMode: v })}
          readOnly={readOnly}
          rows={2}
        />
        <RiskInput
          label="Potential failure effect"
          value={risk.failureEffect}
          placeholder="Impact on the customer if not prevented or corrected"
          onChange={(v) => onChange({ failureEffect: v })}
          readOnly={readOnly}
          rows={2}
        />
      </div>

      {/* Scoring strip: S | Cause | O | Controls | D */}
      <div className="grid grid-cols-1 md:grid-cols-[110px_1fr_110px_1fr_110px] gap-3 p-3 border-b border-slate-100">
        <ScoreSelect
          label="Severity"
          value={risk.severity}
          onChange={(n) => onChange({ severity: n })}
          scale={SEVERITY_SCALE}
          readOnly={readOnly}
          tooltipAlign="right"
        />
        <RiskInput
          label="Potential cause(s)"
          value={risk.cause}
          placeholder="What causes the failure mode? (5-Whys / Ishikawa)"
          onChange={(v) => onChange({ cause: v })}
          readOnly={readOnly}
          rows={2}
        />
        <ScoreSelect
          label="Occurrence"
          value={risk.occurrence}
          onChange={(n) => onChange({ occurrence: n })}
          scale={OCCURRENCE_SCALE}
          readOnly={readOnly}
        />
        <RiskInput
          label="Current controls"
          value={risk.controls}
          placeholder="Prevention or detection controls already in place"
          onChange={(v) => onChange({ controls: v })}
          readOnly={readOnly}
          rows={2}
        />
        <ScoreSelect
          label="Detection"
          value={risk.detection}
          onChange={(n) => onChange({ detection: n })}
          scale={DETECTION_SCALE}
          readOnly={readOnly}
        />
      </div>

      {/* Action plan: recommended | responsible | actions taken */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3">
        <RiskInput
          label="Recommended action"
          value={risk.recommendedAction}
          placeholder="Reduce occurrence and/or improve detection"
          onChange={(v) => onChange({ recommendedAction: v })}
          readOnly={readOnly}
          rows={2}
        />
        <RiskInput
          label="Responsible"
          value={risk.responsible}
          placeholder="Owner / function (e.g. Quality, Mfg Eng)"
          onChange={(v) => onChange({ responsible: v })}
          readOnly={readOnly}
          rows={1}
        />
        <RiskInput
          label="Actions taken"
          value={risk.actionsTaken}
          placeholder="What was done (and when) to close the gap"
          onChange={(v) => onChange({ actionsTaken: v })}
          readOnly={readOnly}
          rows={2}
        />
      </div>

      {/* Revised scoring (collapsed by default) */}
      <div className="border-t border-slate-100 bg-slate-50/60">
        <button
          type="button"
          onClick={() => setShowRevised((v) => !v)}
          className="w-full px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors"
        >
          {showRevised ? '▾' : '▸'} Revised scores (after action)
          {hasRevised && (
            <span className="ml-2 text-emerald-700 normal-case tracking-normal text-[10px] font-semibold">
              · captured
            </span>
          )}
        </button>
        {showRevised && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 border-t border-slate-200">
            <ScoreSelect
              label="Revised severity"
              value={risk.revisedSeverity ?? risk.severity}
              onChange={(n) => onChange({ revisedSeverity: n })}
              scale={SEVERITY_SCALE}
              readOnly={readOnly}
              optional
              onClear={() => onChange({ revisedSeverity: undefined })}
              isSet={typeof risk.revisedSeverity === 'number'}
              tooltipAlign="right"
            />
            <ScoreSelect
              label="Revised occurrence"
              value={risk.revisedOccurrence ?? risk.occurrence}
              onChange={(n) => onChange({ revisedOccurrence: n })}
              scale={OCCURRENCE_SCALE}
              readOnly={readOnly}
              optional
              onClear={() => onChange({ revisedOccurrence: undefined })}
              isSet={typeof risk.revisedOccurrence === 'number'}
            />
            <ScoreSelect
              label="Revised detection"
              value={risk.revisedDetection ?? risk.detection}
              onChange={(n) => onChange({ revisedDetection: n })}
              scale={DETECTION_SCALE}
              readOnly={readOnly}
              optional
              onClear={() => onChange({ revisedDetection: undefined })}
              isSet={typeof risk.revisedDetection === 'number'}
            />
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Reusable inputs
// ---------------------------------------------------------------------------

interface RiskInputProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  rows?: number;
}

const RiskInput: React.FC<RiskInputProps> = ({ label, value, placeholder, onChange, readOnly, rows = 1 }) => {
  return (
    <div>
      <label className="block text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1">
        {label}
      </label>
      {rows <= 1 ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, RISK_TEXT_MAX))}
          disabled={readOnly}
          placeholder={placeholder}
          className="w-full border border-slate-300 px-2 py-1.5 text-[12px] text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50"
        />
      ) : (
        <textarea
          value={value}
          rows={rows}
          onChange={(e) => onChange(e.target.value.slice(0, RISK_TEXT_MAX))}
          disabled={readOnly}
          placeholder={placeholder}
          className="w-full border border-slate-300 px-2 py-1.5 text-[12px] text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50 resize-y leading-snug"
        />
      )}
    </div>
  );
};

interface ScoreSelectProps {
  label: string;
  value: number;
  onChange: (n: number) => void;
  scale: ScaleAnchor[];
  readOnly?: boolean;
  optional?: boolean;
  onClear?: () => void;
  isSet?: boolean;
  // Where the hover tooltip extends. 'left' (default) anchors to the right
  // edge and grows leftward — works for middle / rightmost columns. 'right'
  // anchors to the left edge and grows rightward — used for the leftmost
  // column (Severity) so the tooltip doesn't cover its own score field.
  tooltipAlign?: 'left' | 'right';
}

const ScoreSelect: React.FC<ScoreSelectProps> = ({ label, value, onChange, scale, readOnly, optional, onClear, isSet, tooltipAlign = 'left' }) => {
  // Map score → tone for the select chip background. Higher = more red.
  const tone =
    value >= 8 ? 'bg-rose-50 border-rose-300 text-rose-900'
    : value >= 5 ? 'bg-amber-50 border-amber-300 text-amber-900'
    : 'bg-emerald-50 border-emerald-300 text-emerald-900';

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-1">
        <label className="block text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">
          {label}
        </label>
        <div className="group relative inline-flex items-center">
          <Info size={11} className="text-slate-400 hover:text-slate-700 cursor-help" />
          {/* Tooltip — full scale anchors */}
          <div className={`absolute ${tooltipAlign === 'right' ? 'left-0' : 'right-0'} top-full mt-1 z-30 hidden group-hover:block w-72 bg-slate-900 text-white text-[10px] leading-snug rounded-sm shadow-2xl border border-slate-700 p-2.5`}>
            <p className="font-black uppercase tracking-widest text-[9px] text-white/70 mb-1.5">
              {label} scale (1 = low → 10 = high)
            </p>
            <ul className="space-y-0.5 max-h-56 overflow-y-auto pr-1">
              {scale.map((a) => (
                <li key={a.score} className={`flex items-start gap-2 ${a.score === value ? 'text-amber-300 font-semibold' : ''}`}>
                  <span className="font-black tabular-nums w-4 flex-shrink-0">{a.score}</span>
                  <span><span className="font-semibold">{a.label}</span> — <span className="text-white/70">{a.detail}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <select
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={readOnly}
          className={`w-full border px-2 py-1.5 text-[12px] font-bold tabular-nums focus:outline-none disabled:bg-slate-50 ${tone}`}
        >
          {scale.map((a) => (
            <option key={a.score} value={a.score}>
              {a.score} · {a.label}
            </option>
          ))}
        </select>
        {optional && isSet && !readOnly && onClear && (
          <button
            type="button"
            onClick={onClear}
            title="Clear"
            className="text-slate-400 hover:text-red-600 px-1"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Summary chip
// ---------------------------------------------------------------------------

const TONE_CHIP: Record<string, string> = {
  rose: 'bg-rose-100 text-rose-800 border-rose-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200'
};

const SummaryChip: React.FC<{ label: string; value: number | string; tone: 'rose' | 'amber' | 'emerald' | 'slate' }> = ({ label, value, tone }) => {
  return (
    <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${TONE_CHIP[tone]}`}>
      <span>{label}</span>
      <span className="tabular-nums font-black">{value}</span>
    </span>
  );
};

// ---------------------------------------------------------------------------
// Diagram card wrapper
// ---------------------------------------------------------------------------

const DiagramCard: React.FC<{
  title: string;
  subtitle: string;
  icon: React.FC<{ size?: number; className?: string }>;
  children: React.ReactNode;
}> = ({ title, subtitle, icon: Icon, children }) => {
  return (
    <div className="bg-white border border-slate-200 rounded-sm overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50">
        <Icon size={14} className="text-slate-600" />
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-tight text-slate-900 leading-tight">{title}</p>
          <p className="text-[10px] text-slate-500 leading-tight">{subtitle}</p>
        </div>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Heatmap — Severity (x) × Occurrence (y) grid, 10×10. Cell tint comes from
// the (S × O) baseline (RPN ignoring detection); risk dots are sized by
// detection so the user can see where a weak control is amplifying a
// medium-tier risk.
// ---------------------------------------------------------------------------

const Heatmap: React.FC<{ risks: RiskLine[] }> = ({ risks }) => {
  const cellSize = 28;
  const padding = 28;
  const grid = 10 * cellSize;
  const w = grid + padding * 2;
  const h = grid + padding * 2;

  // Group risks by (S, O) for badging when multiple risks land on same cell.
  const buckets = new Map<string, RiskLine[]>();
  risks.forEach((r) => {
    const key = `${r.severity}_${r.occurrence}`;
    const arr = buckets.get(key) || [];
    arr.push(r);
    buckets.set(key, arr);
  });

  // Cell tint based on S × O (≥ 50 → rose, ≥ 20 → amber, else → emerald).
  const cellFill = (s: number, o: number): string => {
    const v = s * o;
    if (v >= 50) return '#fee2e2'; // rose-100
    if (v >= 20) return '#fef3c7'; // amber-100
    return '#d1fae5';              // emerald-100
  };

  // Dot radius scales with detection (1=small, 10=large)
  const dotR = (d: number) => 4 + (Math.max(1, Math.min(10, d)) - 1) * 0.6;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Severity by Occurrence risk heatmap">
      {/* Cells */}
      {Array.from({ length: 10 }).map((_, sIdx) =>
        Array.from({ length: 10 }).map((_, oIdx) => {
          const s = sIdx + 1;
          const o = 10 - oIdx; // y-axis: 10 at top, 1 at bottom
          const x = padding + sIdx * cellSize;
          const y = padding + oIdx * cellSize;
          return (
            <rect
              key={`${s}_${o}`}
              x={x}
              y={y}
              width={cellSize}
              height={cellSize}
              fill={cellFill(s, o)}
              stroke="white"
              strokeWidth="1"
            />
          );
        })
      )}

      {/* Axis ticks */}
      {Array.from({ length: 10 }).map((_, i) => (
        <text
          key={`xt_${i}`}
          x={padding + i * cellSize + cellSize / 2}
          y={h - padding + 14}
          textAnchor="middle"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="9"
          fontWeight="700"
          fill="#64748b"
        >
          {i + 1}
        </text>
      ))}
      {Array.from({ length: 10 }).map((_, i) => (
        <text
          key={`yt_${i}`}
          x={padding - 8}
          y={padding + i * cellSize + cellSize / 2 + 3}
          textAnchor="end"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="9"
          fontWeight="700"
          fill="#64748b"
        >
          {10 - i}
        </text>
      ))}

      {/* Axis labels */}
      <text x={w / 2} y={h - 4} textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontSize="9" fontWeight="900" letterSpacing="2" fill="#334155">
        SEVERITY →
      </text>
      <text
        x={10}
        y={h / 2}
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="9"
        fontWeight="900"
        letterSpacing="2"
        fill="#334155"
        transform={`rotate(-90 10 ${h / 2})`}
      >
        OCCURRENCE →
      </text>

      {/* Risk dots */}
      {Array.from(buckets.entries()).map(([key, group]) => {
        const [sStr, oStr] = key.split('_');
        const s = Number(sStr);
        const o = Number(oStr);
        const cx = padding + (s - 1) * cellSize + cellSize / 2;
        const cy = padding + (10 - o) * cellSize + cellSize / 2;
        // Use the worst (max RPN) dot as the visual anchor, badge with count.
        const top = group.reduce((acc, r) =>
          computeRPN(r.severity, r.occurrence, r.detection) >
          computeRPN(acc.severity, acc.occurrence, acc.detection) ? r : acc, group[0]);
        const t = rpnTier(computeRPN(top.severity, top.occurrence, top.detection));
        const fill = t === 'high' ? '#e11d48' : t === 'medium' ? '#f59e0b' : '#10b981';
        const r = dotR(top.detection);
        return (
          <g key={key}>
            <circle cx={cx} cy={cy} r={r} fill={fill} stroke="white" strokeWidth="1.5" />
            {group.length > 1 && (
              <text
                x={cx}
                y={cy + 3}
                textAnchor="middle"
                fontFamily="Inter, system-ui, sans-serif"
                fontSize="8"
                fontWeight="900"
                fill="white"
              >
                {group.length}
              </text>
            )}
          </g>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${padding}, ${padding - 18})`}>
        <text fontFamily="Inter, system-ui, sans-serif" fontSize="8" fontWeight="900" letterSpacing="1.5" fill="#475569">
          DOT SIZE = DETECTION (LARGER = HARDER TO DETECT)
        </text>
      </g>
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Pareto — top-10 risks by RPN, horizontal bars.
// ---------------------------------------------------------------------------

const Pareto: React.FC<{ risks: RiskLine[] }> = ({ risks }) => {
  const enriched = risks
    .map((r, idx) => ({
      idx,
      risk: r,
      rpn: computeRPN(r.severity, r.occurrence, r.detection),
      label: r.failureMode || r.processStep || `Risk #${idx + 1}`
    }))
    .filter((x) => x.rpn > 0)
    .sort((a, b) => b.rpn - a.rpn)
    .slice(0, 10);

  if (enriched.length === 0) {
    return (
      <div className="text-center text-[11px] text-slate-400 py-8">
        No risks scored yet — add at least one risk and pick S / O / D.
      </div>
    );
  }

  const max = Math.max(...enriched.map((x) => x.rpn), 1);
  const rowH = 24;
  const w = 600;
  const labelW = 220;
  const barW = w - labelW - 80;
  const h = enriched.length * rowH + 16;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Top 10 risks by RPN">
      {enriched.map((x, i) => {
        const y = i * rowH + 8;
        const tier = rpnTier(x.rpn);
        const fill = tier === 'high' ? '#e11d48' : tier === 'medium' ? '#f59e0b' : '#10b981';
        const len = (x.rpn / max) * barW;
        const labelTrim = x.label.length > 36 ? x.label.slice(0, 34) + '…' : x.label;
        return (
          <g key={x.idx}>
            {/* Index */}
            <text x={4} y={y + rowH / 2 + 3} fontFamily="Inter, system-ui, sans-serif" fontSize="9" fontWeight="900" fill="#94a3b8" letterSpacing="1">
              #{x.idx + 1}
            </text>
            {/* Label */}
            <text x={28} y={y + rowH / 2 + 3} fontFamily="Inter, system-ui, sans-serif" fontSize="10" fontWeight="600" fill="#334155">
              {labelTrim}
            </text>
            {/* Bar */}
            <rect x={labelW} y={y + 3} width={len} height={rowH - 8} fill={fill} rx="1" />
            {/* RPN value */}
            <text x={labelW + len + 4} y={y + rowH / 2 + 3} fontFamily="Inter, system-ui, sans-serif" fontSize="10" fontWeight="900" fill="#0f172a" letterSpacing="0.5">
              {x.rpn}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
