// ---------------------------------------------------------------------------
// TaktStudyTool — Time Study + Takt calculator, scoped to a single project.
//
// Phase 1: scaffold + data model.
//   - List view of studies for the project (one row per study, status badge).
//   - Form view: product title (auto-filled), free-text comment (≤ 200 char),
//     takt inputs (shift, breaks, demand → live takt seconds readout).
//   - Save / Cancel / Delete; persists to the `taktStudies` Firestore
//     collection (one doc per study, owner-isolated by userId+projectId).
//
// Phase 2 (next): step capture with compact +/− zoom rows + multi-cycle
// stopwatch. Steps[] is already on the data model; the form just doesn't
// expose a capture UI yet.
//
// Phase 3 (later): Complete & Validate, xlsx export, Yamazumi, RampScore
// capacity sub-score wiring.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Minus,
  Loader2,
  ArrowLeft,
  Save,
  Trash2,
  RefreshCw,
  Timer,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Play,
  Pause,
  RotateCcw,
  X as XIcon,
  Download
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
import {
  computeTaktSec,
  stepMeanSec,
  stepStdDevSec,
  stepCv,
  stepStandardSec,
  bottleneckSec,
  totalCycleSec,
  lineBalanceLoss,
  capacityVerdict,
  validateStudyForCompletion,
  blockingGaps,
  type ValidationGap
} from './taktMath.ts';
import { downloadStudyXlsx, type TaktXlsxStudy } from './taktXlsx.ts';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type TaktStudyStatus = 'draft' | 'completed';
export type TaktStepVA = 'va' | 'nva' | 'wait';

export interface TaktStep {
  id: string;
  name: string;
  description?: string;
  observations: number[];   // cycle times in seconds
  rating: number;           // 100 = standard performance
  allowance: number;        // PFD %, e.g. 12
  vaType: TaktStepVA;
}

export interface TaktInputs {
  shiftMin: number;         // shift length, minutes
  breakMin: number;         // total break minutes
  demand: number;           // units required per shift
}

export interface TaktStudy {
  id: string;               // Firestore doc id
  userId: string;
  projectId: string;
  name: string;
  productTitle: string;
  comment: string;
  status: TaktStudyStatus;
  takt: TaktInputs;
  steps: TaktStep[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  completedAt?: Timestamp;
}

const COMMENT_MAX = 200;
const STEP_DESC_MAX = 500;
const STEP_NAME_MAX = 80;
const DEFAULT_RATING = 100;     // %, 100 = standard pace
const DEFAULT_ALLOWANCE = 12;   // %, typical PFD allowance
const CV_UNSTABLE = 0.25;       // step flagged as unstable above this CV

// Math (computeTaktSec, stepMeanSec, stepStdDevSec, stepCv, stepStandardSec,
// bottleneckSec) lives in ./taktMath.ts so the Jest suite can import the
// pure helpers without dragging in Firestore / React. Anything you'd want
// to unit-test belongs there, not here.

function formatSeconds(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

// Stable ids for steps so React keys + the expandedStepId pointer survive
// reorderings and avoid relying on array index (which collapses when steps
// are deleted in the middle of the list).
const newStepId = (): string =>
  `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const newStudy = (projectId: string, productType: string, userId: string): TaktStudy => ({
  id: '',
  userId,
  projectId,
  name: 'New time study',
  productTitle: productType || '',
  comment: '',
  status: 'draft',
  takt: { shiftMin: 480, breakMin: 30, demand: 100 },
  steps: []
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TaktStudyToolProps {
  projectId: string;
  productType: string;
  readOnly?: boolean;
}

type Mode = { kind: 'list' } | { kind: 'edit'; study: TaktStudy };

const TaktStudyTool: React.FC<TaktStudyToolProps> = ({
  projectId,
  productType,
  readOnly = false
}) => {
  const [studies, setStudies] = useState<TaktStudy[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  const uid = auth.currentUser?.uid ?? '';

  // -------------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------------
  const loadStudies = async () => {
    if (!uid || !projectId) {
      setStudies([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = query(
        collection(db, 'taktStudies'),
        where('userId', '==', uid),
        where('projectId', '==', projectId),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      const rows: TaktStudy[] = snap.docs.map((d) => {
        const data = d.data() as Omit<TaktStudy, 'id'>;
        return { ...data, id: d.id };
      });
      setStudies(rows);
    } catch (e: any) {
      console.error('[TaktStudyTool] load failed', e);
      setError(e?.message || 'Failed to load studies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStudies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, projectId]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const startNew = () => {
    if (!uid) return;
    setMode({ kind: 'edit', study: newStudy(projectId, productType, uid) });
  };

  const openStudy = (s: TaktStudy) => setMode({ kind: 'edit', study: s });

  const cancelEdit = () => setMode({ kind: 'list' });

  const saveStudy = async (s: TaktStudy) => {
    if (!uid) throw new Error('Not authenticated');
    const payload = {
      userId: uid,
      projectId,
      name: s.name.trim() || 'Untitled study',
      productTitle: s.productTitle.trim(),
      comment: s.comment.slice(0, COMMENT_MAX),
      status: s.status,
      takt: {
        shiftMin: Number(s.takt.shiftMin) || 0,
        breakMin: Number(s.takt.breakMin) || 0,
        demand: Number(s.takt.demand) || 0
      },
      steps: s.steps,
      updatedAt: serverTimestamp()
    };
    let studyId = s.id;
    if (s.id) {
      await updateDoc(doc(db, 'taktStudies', s.id), payload);
    } else {
      const ref = await addDoc(collection(db, 'taktStudies'), {
        ...payload,
        createdAt: serverTimestamp()
      });
      studyId = ref.id;
    }

    // Mirror a snapshot summary onto the project doc when this study moves
    // to 'completed', so RampScore + the project header can show capacity
    // readiness without scanning the taktStudies collection. Drafts never
    // write here. Reopen / Delete leave the snapshot alone — it remains a
    // point-in-time record of the last validated verdict.
    if (s.status === 'completed') {
      try {
        const taktSec = computeTaktSec(s.takt);
        const bottleneck = bottleneckSec(s.steps);
        await updateDoc(doc(db, 'projects', projectId), {
          taktSummary: {
            studyId,
            studyName: payload.name,
            taktSec: Math.round(taktSec * 10) / 10,
            bottleneckSec: Math.round(bottleneck * 10) / 10,
            balanceLoss: Math.round(lineBalanceLoss(s.steps) * 1000) / 1000,
            capacity: capacityVerdict(bottleneck, taktSec),
            completedAtMs: Date.now()
          }
        });
      } catch (e: any) {
        // Don't fail the whole save — the study itself persisted fine. The
        // project mirror is a nice-to-have; log so we'd notice in DevTools.
        console.warn('[TaktStudyTool] taktSummary writeback failed', e);
      }
    }

    await loadStudies();
    setMode({ kind: 'list' });
  };

  const deleteStudy = async (s: TaktStudy) => {
    if (!s.id) return;
    if (!confirm(`Delete "${s.name}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'taktStudies', s.id));
      await loadStudies();
    } catch (e: any) {
      console.error('[TaktStudyTool] delete failed', e);
      alert(e?.message || 'Delete failed');
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-xl overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Timer size={20} className="text-slate-300" />
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/70 mb-1">
              Tool
            </p>
            <h3 className="text-lg font-black uppercase tracking-tight leading-tight">
              Time Studies
            </h3>
          </div>
        </div>
        {mode.kind === 'list' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadStudies}
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
                <Plus size={12} /> New Study
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
            <StudyList
              studies={studies}
              loading={loading}
              error={error}
              onOpen={openStudy}
              onDelete={deleteStudy}
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
            <StudyForm
              initial={mode.study}
              onCancel={cancelEdit}
              onSave={saveStudy}
              readOnly={readOnly}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

interface StudyListProps {
  studies: TaktStudy[];
  loading: boolean;
  error: string | null;
  onOpen: (s: TaktStudy) => void;
  onDelete: (s: TaktStudy) => void;
  readOnly: boolean;
}

const StudyList: React.FC<StudyListProps> = ({ studies, loading, error, onOpen, onDelete, readOnly }) => {
  if (loading) {
    return (
      <div className="px-6 py-10 flex items-center justify-center text-slate-400 text-sm gap-2">
        <Loader2 size={14} className="animate-spin" /> Loading studies…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-6 py-10 flex items-center gap-2 text-red-600 text-sm">
        <AlertTriangle size={14} /> {error}
      </div>
    );
  }
  if (studies.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <Timer size={32} className="text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500 mb-1 font-medium">No time studies yet.</p>
        <p className="text-xs text-slate-400">
          {readOnly ? 'This project is read-only.' : 'Click "New Study" to capture cycle times and calculate takt.'}
        </p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-slate-100">
      {studies.map((s) => (
        <StudyRow key={s.id} study={s} onOpen={onOpen} onDelete={onDelete} readOnly={readOnly} />
      ))}
    </div>
  );
};

const StudyRow: React.FC<{
  study: TaktStudy;
  onOpen: (s: TaktStudy) => void;
  onDelete: (s: TaktStudy) => void;
  readOnly: boolean;
}> = ({ study, onOpen, onDelete, readOnly }) => {
  const taktSec = computeTaktSec(study.takt);
  const stepCount = study.steps?.length ?? 0;
  const isCompleted = study.status === 'completed';
  // Convert the persisted shape into the xlsx payload. Last-saved state, not
  // the in-flight form buffer (the row doesn't have access to that).
  const handleExport = (e: React.MouseEvent) => {
    e.stopPropagation();
    const payload: TaktXlsxStudy = {
      id: study.id,
      name: study.name,
      productTitle: study.productTitle,
      comment: study.comment,
      status: study.status,
      takt: study.takt,
      steps: (study.steps ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        observations: s.observations,
        rating: s.rating,
        allowance: s.allowance,
        vaType: s.vaType
      })),
      createdAtMs: study.createdAt?.toMillis(),
      updatedAtMs: study.updatedAt?.toMillis(),
      completedAtMs: study.completedAt?.toMillis()
    };
    downloadStudyXlsx(payload);
  };
  return (
    <div className="px-6 py-4 hover:bg-slate-50 transition-colors flex items-center gap-4">
      <button
        type="button"
        onClick={() => onOpen(study)}
        className="flex-1 min-w-0 text-left flex items-center gap-4"
      >
        <StatusBadge status={study.status} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black tracking-tight text-slate-900 truncate">
            {study.name || 'Untitled study'}
          </p>
          <p className="text-xs text-slate-500 truncate">
            {study.productTitle || 'No product title'} · {stepCount} step{stepCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Takt</p>
          <p className={`text-sm font-black tabular-nums ${isCompleted ? 'text-slate-900' : 'text-slate-500'}`}>
            {formatSeconds(taktSec)}
          </p>
        </div>
      </button>
      <button
        type="button"
        onClick={handleExport}
        className="text-slate-400 hover:text-slate-900 transition-colors p-2"
        title="Download as xlsx"
        aria-label="Download study as xlsx"
      >
        <Download size={14} />
      </button>
      {!readOnly && (
        <button
          type="button"
          onClick={() => onDelete(study)}
          className="text-slate-300 hover:text-red-600 transition-colors p-2"
          title="Delete study"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};

const StatusBadge: React.FC<{ status: TaktStudyStatus }> = ({ status }) => {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1">
        <CheckCircle2 size={10} /> Completed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-600 bg-slate-100 border border-slate-200 px-2 py-1">
      <CircleDot size={10} /> Draft
    </span>
  );
};

// ---------------------------------------------------------------------------
// Form view
// ---------------------------------------------------------------------------

interface StudyFormProps {
  initial: TaktStudy;
  onCancel: () => void;
  onSave: (s: TaktStudy) => Promise<void>;
  readOnly: boolean;
}

const StudyForm: React.FC<StudyFormProps> = ({ initial, onCancel, onSave, readOnly }) => {
  const [name, setName] = useState(initial.name);
  const [productTitle, setProductTitle] = useState(initial.productTitle);
  const [comment, setComment] = useState(initial.comment);
  const [shiftMin, setShiftMin] = useState<number>(initial.takt.shiftMin);
  const [breakMin, setBreakMin] = useState<number>(initial.takt.breakMin);
  const [demand, setDemand] = useState<number>(initial.takt.demand);
  // Step list lives in form state so additions / cycle observations / rating
  // changes don't fire Firestore writes on every keystroke — flushed on Save.
  const [steps, setSteps] = useState<TaktStep[]>(initial.steps ?? []);
  // Only one step expanded at a time keeps the form scannable on a phone.
  // null = all collapsed (compact rows only).
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  // Status lives in form state so Complete / Reopen can flip it locally and
  // pass it to onSave atomically. Phase 3 will gate Complete behind a
  // validation check (sample size, CV, rating set, etc).
  const [status, setStatus] = useState<TaktStudyStatus>(initial.status);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Validation gaps from the last Complete attempt. Used both to block
  // completion (when any are level: 'block') and to surface advisory
  // warnings on the verdict panel after a study is locked.
  const [gaps, setGaps] = useState<ValidationGap[]>([]);

  const taktSec = useMemo(
    () => computeTaktSec({ shiftMin, breakMin, demand }),
    [shiftMin, breakMin, demand]
  );

  // Bottleneck = the step with the highest standard time (= line constraint).
  // Phase 3 surfaces this in the Complete verdict; Phase 2 just shows it
  // alongside the takt readout so the observer sees parity with takt live.
  const bottleneckStandardSec = useMemo(() => bottleneckSec(steps), [steps]);
  const bottleneckOverTakt =
    taktSec > 0 && bottleneckStandardSec > taktSec;

  // A completed study is locked from edits until the user clicks Reopen.
  // This keeps the audit trail honest — you can't silently tweak data
  // after declaring a study done.
  const formLocked = readOnly || status === 'completed';

  // Build the payload once so Save and Complete share the exact same shape.
  const buildPayload = (overrideStatus?: TaktStudyStatus): TaktStudy => ({
    ...initial,
    name,
    productTitle,
    comment: comment.slice(0, COMMENT_MAX),
    takt: { shiftMin, breakMin, demand },
    steps,
    status: overrideStatus ?? status
  });

  // ---- Step mutators ------------------------------------------------------
  // All step edits go through these so the compact-row and zoomed-panel UIs
  // stay in lockstep with form state. Patch-style updates (vs. setSteps with
  // a full new array) keep changesets tight and React reconciliation cheap.
  const addStep = useCallback(() => {
    setSteps((prev) => {
      const next: TaktStep = {
        id: newStepId(),
        name: `Step ${prev.length + 1}`,
        description: '',
        observations: [],
        rating: DEFAULT_RATING,
        allowance: DEFAULT_ALLOWANCE,
        vaType: 'va'
      };
      // Expand the new row so the user lands directly in capture mode —
      // saves a click on a phone where +/− targets are small.
      setExpandedStepId(next.id);
      return [...prev, next];
    });
  }, []);

  const updateStep = useCallback(
    (id: string, patch: Partial<TaktStep>) => {
      setSteps((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
      );
    },
    []
  );

  const removeStep = useCallback(
    (id: string) => {
      setSteps((prev) => prev.filter((s) => s.id !== id));
      setExpandedStepId((curr) => (curr === id ? null : curr));
    },
    []
  );

  const toggleExpandStep = useCallback(
    (id: string) => {
      setExpandedStepId((curr) => (curr === id ? null : id));
    },
    []
  );

  const handleSave = async () => {
    if (formLocked) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(buildPayload());
    } catch (e: any) {
      console.error('[TaktStudyTool] save failed', e);
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Single-click Complete: validates first, then persists current edits AND
  // flips status to 'completed' atomically. Reopen is the inverse path
  // (always allowed; clears the gaps banner).
  const handleToggleComplete = async () => {
    if (readOnly) return;
    const nextStatus: TaktStudyStatus =
      status === 'completed' ? 'draft' : 'completed';

    // Reopen path — no validation, just flip status.
    if (nextStatus === 'draft') {
      setSaving(true);
      setSaveError(null);
      try {
        await onSave(buildPayload(nextStatus));
        setStatus(nextStatus);
        setGaps([]); // clear stale validation messages
      } catch (e: any) {
        console.error('[TaktStudyTool] reopen failed', e);
        setSaveError(e?.message || 'Could not reopen the study');
      } finally {
        setSaving(false);
      }
      return;
    }

    // Complete path — run validation gates first.
    const taktNow = computeTaktSec({ shiftMin, breakMin, demand });
    const found = validateStudyForCompletion(
      steps.map((s) => ({ name: s.name, observations: s.observations })),
      taktNow
    );
    setGaps(found);
    const blocking = blockingGaps(found);
    if (blocking.length > 0) {
      setSaveError(
        `Cannot complete: ${blocking.length} blocker${
          blocking.length === 1 ? '' : 's'
        } — see list below.`
      );
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(buildPayload(nextStatus));
      setStatus(nextStatus);
      // Keep gaps array (now warnings only) so the verdict panel can show
      // them as advisories. Clear on Reopen.
    } catch (e: any) {
      console.error('[TaktStudyTool] complete failed', e);
      setSaveError(e?.message || 'Could not update study status');
    } finally {
      setSaving(false);
    }
  };

  // Snapshot the current edit buffer as an xlsx-shaped payload, then trigger
  // the browser download. We export the LIVE state, not the persisted state,
  // so the user gets what they see (including unsaved tweaks).
  const handleExportXlsx = () => {
    const payload: TaktXlsxStudy = {
      id: initial.id,
      name,
      productTitle,
      comment,
      status,
      takt: { shiftMin, breakMin, demand },
      steps: steps.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        observations: s.observations,
        rating: s.rating,
        allowance: s.allowance,
        vaType: s.vaType
      })),
      createdAtMs: initial.createdAt?.toMillis(),
      updatedAtMs: initial.updatedAt?.toMillis(),
      completedAtMs: initial.completedAt?.toMillis()
    };
    downloadStudyXlsx(payload);
  };

  return (
    <div className="px-6 py-6 space-y-6">
      {/* Sub-header / back */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1"
        >
          <ArrowLeft size={12} /> Back to studies
        </button>
        <StatusBadge status={status} />
      </div>

      {/* Identity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Study name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={formLocked}
            placeholder="e.g. Line A pilot run"
            className="w-full border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-slate-900 disabled:bg-slate-50"
          />
        </Field>
        <Field label="Product title">
          <input
            type="text"
            value={productTitle}
            onChange={(e) => setProductTitle(e.target.value)}
            disabled={formLocked}
            placeholder="Auto-filled from project"
            className="w-full border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-slate-900 disabled:bg-slate-50"
          />
        </Field>
      </div>

      {/* Comment with live counter */}
      <Field
        label="Comment"
        hint={`${comment.length} / ${COMMENT_MAX}`}
      >
        <textarea
          value={comment}
          onChange={(e) =>
            setComment(e.target.value.length > COMMENT_MAX
              ? e.target.value.slice(0, COMMENT_MAX)
              : e.target.value)
          }
          disabled={formLocked}
          placeholder="Notes on observation conditions, operator, line state, etc."
          rows={3}
          className="w-full border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-slate-900 disabled:bg-slate-50 resize-none"
        />
      </Field>

      {/* Takt inputs */}
      <div>
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500 mb-3">
          Takt inputs
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <NumberField
            label="Shift (min)"
            value={shiftMin}
            min={0}
            onChange={setShiftMin}
            disabled={formLocked}
          />
          <NumberField
            label="Breaks (min)"
            value={breakMin}
            min={0}
            onChange={setBreakMin}
            disabled={formLocked}
          />
          <NumberField
            label="Demand (units)"
            value={demand}
            min={0}
            onChange={setDemand}
            disabled={formLocked}
          />
          {(() => {
            // Live takt panel — adapts as steps come in. Without steps it
            // shows takt only (the demand drumbeat is independent of how you
            // build the part). Once steps exist, surfaces capacity verdict +
            // headroom so the observer sees the gap forming live, not just
            // after Complete. Bottleneck stays on the Steps header so the
            // two readouts sit close together visually.
            const verdict = capacityVerdict(bottleneckStandardSec, taktSec);
            const hasSteps = steps.length > 0 && bottleneckStandardSec > 0;
            const headroomPct =
              hasSteps && taktSec > 0
                ? Math.round((1 - bottleneckStandardSec / taktSec) * 1000) / 10
                : null;
            // Verdict band tints the top of the panel; the body stays
            // slate-900 to preserve brand identity. Yellow = neutral, used
            // when there's no signal yet so the panel doesn't scream green.
            const bandColor =
              !hasSteps || taktSec <= 0
                ? 'bg-slate-700'
                : verdict === 'green'
                  ? 'bg-emerald-600'
                  : verdict === 'yellow'
                    ? 'bg-amber-500'
                    : 'bg-red-600';
            const verdictLabel =
              !hasSteps || taktSec <= 0
                ? 'Awaiting steps'
                : verdict === 'green'
                  ? 'Capacity OK'
                  : verdict === 'yellow'
                    ? 'Tight'
                    : 'Capacity short';
            return (
              <div className="bg-slate-900 text-white overflow-hidden">
                <div
                  className={`${bandColor} px-3 py-1 transition-colors flex items-center justify-between`}
                >
                  <span className="text-[9px] font-black uppercase tracking-widest text-white">
                    Takt time
                  </span>
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/90">
                    {verdictLabel}
                  </span>
                </div>
                <div className="px-3 py-2.5 space-y-1">
                  <p className="text-xl font-black tabular-nums leading-none">
                    {formatSeconds(taktSec)}
                  </p>
                  <p className="text-[10px] text-white/60">
                    {taktSec > 0
                      ? `${taktSec.toFixed(1)} sec/unit`
                      : 'Set inputs above'}
                  </p>
                  {hasSteps && taktSec > 0 && (
                    <div className="pt-2 mt-2 border-t border-white/15 space-y-0.5">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-white/70">Bottleneck</span>
                        <span className="font-bold tabular-nums">
                          {formatSeconds(bottleneckStandardSec)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-white/70">Headroom</span>
                        <span
                          className={`font-bold tabular-nums ${
                            headroomPct !== null && headroomPct < 0
                              ? 'text-red-300'
                              : ''
                          }`}
                        >
                          {headroomPct !== null
                            ? `${headroomPct > 0 ? '+' : ''}${headroomPct.toFixed(1)}%`
                            : '—'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Steps — compact rows with a +/− zoom toggle. Expanded row reveals
          description, multi-cycle stopwatch, rating, allowance, VA / NVA. */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">
            Assembly steps
            {steps.length > 0 && (
              <span className="ml-2 text-slate-400">({steps.length})</span>
            )}
          </p>
          <div className="flex items-center gap-3">
            {bottleneckStandardSec > 0 && (
              <span
                className={`text-[10px] font-black uppercase tracking-widest tabular-nums ${
                  bottleneckOverTakt ? 'text-red-600' : 'text-slate-500'
                }`}
                title="Standard time of the slowest step"
              >
                Bottleneck {formatSeconds(bottleneckStandardSec)}
              </span>
            )}
            <button
              type="button"
              onClick={addStep}
              disabled={formLocked}
              className="text-[10px] font-black uppercase tracking-widest text-blue-700 hover:text-blue-900 disabled:opacity-40 flex items-center gap-1"
            >
              <Plus size={12} /> Add step
            </button>
          </div>
        </div>

        {steps.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 px-4 py-8 text-center">
            <p className="text-xs text-slate-400">
              No steps yet — click <strong>Add step</strong> to start
              capturing cycle times.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {steps.map((step, idx) => (
              <StepRow
                key={step.id}
                step={step}
                index={idx}
                taktSec={taktSec}
                expanded={expandedStepId === step.id}
                readOnly={formLocked}
                onToggle={() => toggleExpandStep(step.id)}
                onChange={(patch) => updateStep(step.id, patch)}
                onDelete={() => removeStep(step.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Verdict panel — only visible once the study is marked completed.
          Locks in the validated takt, bottleneck, balance loss, and
          Yamazumi visualization for post-mortem and report-out. */}
      {status === 'completed' && (
        <VerdictPanel
          taktSec={taktSec}
          steps={steps}
          gaps={gaps}
        />
      )}

      {/* Validation gaps banner — shown after a Complete attempt. Block-level
          gaps prevent the lock; warnings are advisory and don't block but
          remain visible until the next Complete pass. */}
      {gaps.length > 0 && status !== 'completed' && blockingGaps(gaps).length > 0 && (
        <div className="space-y-1 border border-amber-200 bg-amber-50 px-3 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-900 mb-1 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Cannot complete yet — fix the issues
            below
          </p>
          <ul className="space-y-1 ml-1">
            {gaps.map((g, i) => (
              <li
                key={i}
                className={`text-xs flex items-start gap-1.5 ${
                  g.level === 'block' ? 'text-red-700' : 'text-amber-800'
                }`}
              >
                <span
                  className={`mt-0.5 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    g.level === 'block' ? 'bg-red-500' : 'bg-amber-500'
                  }`}
                />
                <span>{g.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Locked-form notice when the study has been marked Completed.
          Click Reopen to edit again. */}
      {status === 'completed' && !readOnly && (
        <div className="flex items-center gap-2 px-3 py-2 border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs">
          <CheckCircle2 size={14} />
          <span>
            This study is marked completed and locked from edits. Click{' '}
            <strong>Reopen</strong> below to make changes.
          </span>
        </div>
      )}

      {/* Save bar */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
        {saveError && (
          <span className="text-xs text-red-600 mr-auto flex items-center gap-1">
            <AlertTriangle size={12} /> {saveError}
          </span>
        )}
        <button
          type="button"
          onClick={handleExportXlsx}
          disabled={saving}
          className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          title="Download this study as an Excel workbook"
        >
          <Download size={12} /> .xlsx
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        {/* Complete / Reopen — declares the study done and triggers the
            validated takt readout (Phase 3 will gate this behind a fuller
            validation pass before allowing the lock). */}
        <button
          type="button"
          onClick={handleToggleComplete}
          disabled={saving || readOnly}
          className={
            status === 'completed'
              ? 'border border-slate-300 hover:border-slate-900 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 text-slate-700 hover:text-slate-900 disabled:opacity-50'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow disabled:opacity-50'
          }
          title={
            status === 'completed'
              ? 'Reopen to edit'
              : 'Mark this study completed and validate takt'
          }
        >
          {saving ? (
            <Loader2 size={12} className="animate-spin" />
          ) : status === 'completed' ? (
            <RefreshCw size={12} />
          ) : (
            <CheckCircle2 size={12} />
          )}
          {status === 'completed' ? 'Reopen' : 'Complete'}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || formLocked}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tiny field primitives
// ---------------------------------------------------------------------------

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children
}) => (
  <label className="block">
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">
        {label}
      </span>
      {hint && (
        <span className="text-[9px] font-mono text-slate-400 tabular-nums">{hint}</span>
      )}
    </div>
    {children}
  </label>
);

const NumberField: React.FC<{
  label: string;
  value: number;
  min?: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}> = ({ label, value, min, onChange, disabled }) => (
  <Field label={label}>
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      onChange={(e) => onChange(Number(e.target.value))}
      disabled={disabled}
      className="w-full border border-slate-200 px-3 py-2 text-sm tabular-nums focus:outline-none focus:border-slate-900 disabled:bg-slate-50"
    />
  </Field>
);

// ---------------------------------------------------------------------------
// StepRow — compact single-line by default; +/− expands an inline panel with
// description, multi-cycle stopwatch, rating, allowance, and VA/NVA type.
// Designed to keep first-impression complexity low (only 4 visible controls
// per row when collapsed) while still surfacing IE-grade detail on demand.
// ---------------------------------------------------------------------------

interface StepRowProps {
  step: TaktStep;
  index: number;
  taktSec: number;
  expanded: boolean;
  readOnly: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<TaktStep>) => void;
  onDelete: () => void;
}

const StepRow: React.FC<StepRowProps> = ({
  step,
  index,
  taktSec,
  expanded,
  readOnly,
  onToggle,
  onChange,
  onDelete
}) => {
  const meanS = stepMeanSec(step);
  const stdS = stepStdDevSec(step);
  const cvVal = stepCv(step);
  const standardS = stepStandardSec(step);
  const overTakt = taktSec > 0 && standardS > taktSec;
  // CV > 0.25 is the classic IE rule of thumb for "unstable, collect more
  // cycles before trusting the number." Two samples minimum to be meaningful.
  const unstable = step.observations.length >= 2 && cvVal > CV_UNSTABLE;

  return (
    <div
      className={`bg-white border transition-colors ${
        expanded ? 'border-slate-900' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* Compact row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex-shrink-0 w-7 h-7 border border-slate-300 hover:border-slate-900 flex items-center justify-center text-slate-700"
          title={expanded ? 'Collapse step' : 'Expand step'}
          aria-label={expanded ? 'Collapse step' : 'Expand step'}
          aria-expanded={expanded}
        >
          {expanded ? <Minus size={14} /> : <Plus size={14} />}
        </button>
        <span className="w-7 text-[10px] font-black text-slate-400 text-center tabular-nums">
          #{index + 1}
        </span>
        <input
          type="text"
          value={step.name}
          onChange={(e) =>
            onChange({ name: e.target.value.slice(0, STEP_NAME_MAX) })
          }
          disabled={readOnly}
          placeholder="Step name"
          className="flex-1 min-w-0 px-2 py-1 text-sm border border-transparent hover:border-slate-200 focus:border-slate-900 focus:outline-none disabled:bg-slate-50"
          aria-label={`Step ${index + 1} name`}
        />
        <div className="flex items-center gap-1 text-right tabular-nums flex-shrink-0">
          <span
            className={`text-[11px] font-black ${
              overTakt ? 'text-red-600' : 'text-slate-700'
            }`}
          >
            {meanS > 0 ? formatSeconds(meanS) : '—'}
          </span>
          <span className="text-[10px] text-slate-400">
            ({step.observations.length} cyc)
          </span>
        </div>
        {unstable && (
          <span
            title={`CV ${(cvVal * 100).toFixed(1)}% — add more cycles`}
            className="flex-shrink-0"
          >
            <AlertTriangle size={14} className="text-amber-500" />
          </span>
        )}
        {!readOnly && (
          <button
            type="button"
            onClick={onDelete}
            className="text-slate-300 hover:text-red-600 p-1 flex-shrink-0"
            title="Remove step"
            aria-label="Remove step"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-3 space-y-3">
          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">
                Description
              </span>
              <span
                className={`text-[9px] tabular-nums ${
                  step.description.length >= STEP_DESC_MAX
                    ? 'text-red-600'
                    : 'text-slate-400'
                }`}
              >
                {step.description.length}/{STEP_DESC_MAX}
              </span>
            </div>
            <textarea
              value={step.description ?? ''}
              onChange={(e) =>
                onChange({
                  description:
                    e.target.value.length > STEP_DESC_MAX
                      ? e.target.value.slice(0, STEP_DESC_MAX)
                      : e.target.value
                })
              }
              disabled={readOnly}
              rows={2}
              placeholder="Start trigger / end trigger. e.g. 'Start: pick part from bin · End: place screwdriver down.'"
              className="w-full border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-slate-900 disabled:bg-slate-50 resize-none"
            />
          </div>

          {/* Stopwatch + observations */}
          <Stopwatch
            observations={step.observations}
            readOnly={readOnly}
            onChange={(next) => onChange({ observations: next })}
          />

          {/* Live mini-readout — μ, σ, CV, n, standard time. No headline
              takt verdict here; that lives on Complete (Phase 3). */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-medium tabular-nums text-slate-600 px-1">
            <span>
              μ <strong>{meanS > 0 ? `${meanS.toFixed(1)}s` : '—'}</strong>
            </span>
            <span>
              σ <strong>{stdS > 0 ? `${stdS.toFixed(2)}s` : '—'}</strong>
            </span>
            <span className={unstable ? 'text-amber-600' : ''}>
              CV{' '}
              <strong>
                {cvVal > 0 ? `${(cvVal * 100).toFixed(1)}%` : '—'}
              </strong>
            </span>
            <span>
              n <strong>{step.observations.length}</strong>
            </span>
            <span className="ml-auto">
              Standard{' '}
              <strong
                className={overTakt ? 'text-red-600' : 'text-slate-900'}
              >
                {standardS > 0 ? formatSeconds(standardS) : '—'}
              </strong>
            </span>
          </div>

          {/* Rating / allowance / VA-NVA */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Rating (%)" hint="100 = standard pace">
              <input
                type="number"
                value={step.rating}
                onChange={(e) =>
                  onChange({
                    rating: Math.max(0, Math.min(150, Number(e.target.value) || 0))
                  })
                }
                min={0}
                max={150}
                disabled={readOnly}
                className="w-full border border-slate-200 px-3 py-2 text-sm tabular-nums focus:outline-none focus:border-slate-900 disabled:bg-slate-50"
              />
            </Field>
            <Field label="Allowance (%)" hint="PFD: typical 10–15%">
              <input
                type="number"
                value={step.allowance}
                onChange={(e) =>
                  onChange({
                    allowance: Math.max(0, Math.min(50, Number(e.target.value) || 0))
                  })
                }
                min={0}
                max={50}
                disabled={readOnly}
                className="w-full border border-slate-200 px-3 py-2 text-sm tabular-nums focus:outline-none focus:border-slate-900 disabled:bg-slate-50"
              />
            </Field>
            <Field
              label="Type"
              hint="Lean classification — hover each for examples"
            >
              <div className="flex border border-slate-200">
                {(['va', 'nva', 'wait'] as TaktStepVA[]).map((v) => {
                  const isActive = step.vaType === v;
                  const baseColor =
                    v === 'va'
                      ? 'bg-emerald-600'
                      : v === 'nva'
                        ? 'bg-amber-500'
                        : 'bg-slate-400';
                  // Native title= tooltip. Multi-line via \n renders on most
                  // browsers; falls back to single-line otherwise. Examples
                  // are intentionally concrete so a first-time user doesn't
                  // have to guess what to pick.
                  const tooltip =
                    v === 'va'
                      ? 'Value-Add\nWork the customer pays for — physically transforms the product or gets it closer to done.\nExamples: tightening screws, soldering joints, applying coating, programming firmware.'
                      : v === 'nva'
                        ? 'Non-Value-Add\nNecessary work that doesn’t transform the product. Customer wouldn’t pay for it if they had a choice, but you can’t skip it.\nExamples: inspection, moving parts between stations, packaging, paperwork, setup / changeover, deburring.'
                        : 'Wait / idle\nOperator (or the part) is doing nothing — pure waste.\nExamples: waiting for machine cycle, kit delivery, QC sign-off, material at the station.';
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => onChange({ vaType: v })}
                      disabled={readOnly}
                      className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-60 ${
                        isActive
                          ? `${baseColor} text-white`
                          : 'bg-white text-slate-500 hover:bg-slate-100'
                      }`}
                      title={tooltip}
                      aria-label={tooltip}
                    >
                      {v.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Stopwatch — snap-back lap timer. Click Start to count up; Lap pushes the
// elapsed value into observations[] and resets the clock; Reset clears the
// running clock without touching observations. Manual entry lets the user
// type a value directly (e.g. when reviewing a video after the fact).
// 100ms tick is plenty for shop-floor accuracy and pauses cleanly when the
// browser tab goes idle.
// ---------------------------------------------------------------------------

interface StopwatchProps {
  observations: number[];
  readOnly: boolean;
  onChange: (next: number[]) => void;
}

const formatStopwatch = (ms: number): string => {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m.toString().padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
};

const Stopwatch: React.FC<StopwatchProps> = ({
  observations,
  readOnly,
  onChange
}) => {
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [manualEntry, setManualEntry] = useState('');
  const startRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Drive the clock while running. Re-attaches on resume so pauses don't
  // accumulate phantom time.
  useEffect(() => {
    if (running) {
      startRef.current = performance.now() - elapsedMs;
      tickRef.current = setInterval(() => {
        if (startRef.current != null) {
          setElapsedMs(performance.now() - startRef.current);
        }
      }, 100);
    }
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // If the row collapses or the form unmounts, halt the clock so we don't
  // leak a setInterval into the void.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const handleStartStop = () => {
    if (readOnly) return;
    setRunning((r) => !r);
  };

  const handleLap = () => {
    if (readOnly) return;
    if (elapsedMs <= 0) return;
    const sec = Math.round((elapsedMs / 1000) * 10) / 10;
    onChange([...observations, sec]);
    setElapsedMs(0);
    startRef.current = performance.now();
  };

  const handleReset = () => {
    if (readOnly) return;
    setRunning(false);
    setElapsedMs(0);
  };

  const handleManualAdd = () => {
    if (readOnly) return;
    const n = Number(manualEntry);
    if (!isFinite(n) || n <= 0) return;
    onChange([...observations, Math.round(n * 10) / 10]);
    setManualEntry('');
  };

  const handleRemove = (idx: number) => {
    if (readOnly) return;
    onChange(observations.filter((_, i) => i !== idx));
  };

  return (
    <div className="bg-white border border-slate-200 px-3 py-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Timer size={14} className="text-slate-400" />
          <span className="text-3xl font-black tabular-nums tracking-tight text-slate-900">
            {formatStopwatch(elapsedMs)}
          </span>
          {running && (
            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-red-600">
              <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
              Recording
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleStartStop}
            disabled={readOnly}
            className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 disabled:opacity-50 ${
              running
                ? 'bg-slate-900 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            {running ? <Pause size={12} /> : <Play size={12} />}
            {running ? 'Stop' : 'Start'}
          </button>
          <button
            type="button"
            onClick={handleLap}
            disabled={readOnly || elapsedMs <= 0}
            className="px-3 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
            title="Record this cycle and snap clock back to 0"
          >
            <Plus size={12} /> Lap
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={readOnly || (elapsedMs <= 0 && !running)}
            className="px-3 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 border border-slate-300 hover:border-slate-900 text-slate-700 disabled:opacity-40"
            title="Clear the running clock (does not delete recorded cycles)"
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </div>

      {/* Manual entry — when reviewing video or recovering from a missed lap */}
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={manualEntry}
          onChange={(e) => setManualEntry(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleManualAdd();
            }
          }}
          disabled={readOnly}
          placeholder="Manual entry (sec)"
          step={0.1}
          min={0}
          className="flex-1 max-w-[180px] border border-slate-200 px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:border-slate-900 disabled:bg-slate-50"
        />
        <button
          type="button"
          onClick={handleManualAdd}
          disabled={readOnly || !manualEntry.trim()}
          className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest border border-slate-300 hover:border-slate-900 text-slate-700 disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {/* Observation chips. Each chip can be removed individually so a
          mis-clicked lap doesn't force the operator to start over. */}
      {observations.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {observations.map((sec, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] tabular-nums text-slate-700"
            >
              <span className="text-slate-400 text-[9px]">#{idx + 1}</span>
              {sec.toFixed(1)}s
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleRemove(idx)}
                  className="text-slate-300 hover:text-red-600 ml-0.5"
                  title="Remove this cycle"
                  aria-label={`Remove cycle ${idx + 1}`}
                >
                  <XIcon size={11} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// VerdictPanel — only rendered after a study is marked completed. Shows the
// validated takt, bottleneck step, total cycle time, balance loss, capacity
// status, and a Yamazumi chart. Warnings (non-blocking gaps) appear here
// as advisory notes so the operator knows what to firm up next time.
// ---------------------------------------------------------------------------

const VERDICT_BG: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-emerald-600',
  yellow: 'bg-amber-500',
  red: 'bg-red-600'
};

const VERDICT_LABEL: Record<'green' | 'yellow' | 'red', string> = {
  green: 'Capacity OK — ≥ 10% headroom',
  yellow: 'Tight — < 10% headroom',
  red: 'Capacity short — bottleneck > takt'
};

interface VerdictPanelProps {
  taktSec: number;
  steps: TaktStep[];
  gaps: ValidationGap[];
}

const VerdictPanel: React.FC<VerdictPanelProps> = ({ taktSec, steps, gaps }) => {
  const bottleneck = bottleneckSec(steps);
  const total = totalCycleSec(steps);
  const balanceLoss = lineBalanceLoss(steps);
  const verdict = capacityVerdict(bottleneck, taktSec);
  const headroom =
    taktSec > 0 && bottleneck > 0
      ? Math.round((1 - bottleneck / taktSec) * 1000) / 10
      : 0;
  // Identify the bottleneck step for highlighting in the chart + label.
  const bottleneckIdx = steps.reduce((idx, s, i) => {
    const t = stepStandardSec(s);
    return t > stepStandardSec(steps[idx]) ? i : idx;
  }, 0);
  const bottleneckStep = steps[bottleneckIdx];

  // Warnings that survived completion (non-blocking advisories).
  const warns = gaps.filter((g) => g.level === 'warn');

  return (
    <div className="border-2 border-slate-900 bg-white">
      {/* Verdict bar */}
      <div className={`${VERDICT_BG[verdict]} text-white px-4 py-3 flex items-center gap-3`}>
        <CheckCircle2 size={18} className="flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/70">
            Validated takt
          </p>
          <p className="text-base font-black leading-tight tracking-tight">
            {VERDICT_LABEL[verdict]}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[9px] font-black uppercase tracking-widest text-white/60">
            Headroom
          </p>
          <p className="text-2xl font-black tabular-nums leading-none">
            {taktSec > 0 ? `${headroom}%` : '—'}
          </p>
        </div>
      </div>

      {/* Numeric grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-slate-200 border-b border-slate-200">
        <VerdictMetric label="Takt time" value={formatSeconds(taktSec)} />
        <VerdictMetric
          label="Bottleneck"
          value={formatSeconds(bottleneck)}
          sub={bottleneckStep ? `#${bottleneckIdx + 1} · ${bottleneckStep.name}` : undefined}
          accent={verdict === 'red' ? 'red' : undefined}
        />
        <VerdictMetric
          label="Total cycle"
          value={formatSeconds(total)}
          sub={`${steps.length} step${steps.length === 1 ? '' : 's'}`}
        />
        <VerdictMetric
          label="Balance loss"
          value={`${(balanceLoss * 100).toFixed(1)}%`}
          sub={balanceLoss > 0.15 ? 'Rebalancing recommended' : 'Acceptable'}
          accent={balanceLoss > 0.15 ? 'amber' : undefined}
        />
      </div>

      {/* Yamazumi chart */}
      <div className="px-4 py-4 border-b border-slate-200">
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500 mb-2">
          Cycle time per step vs. takt
        </p>
        <YamazumiChart
          steps={steps}
          taktSec={taktSec}
          bottleneckIdx={bottleneckIdx}
        />
      </div>

      {/* Advisory warnings (non-blocking gaps from validation) */}
      {warns.length > 0 && (
        <div className="px-4 py-3 bg-amber-50 border-t border-amber-200">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-900 mb-1 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Advisories
          </p>
          <ul className="space-y-0.5 ml-1">
            {warns.map((g, i) => (
              <li
                key={i}
                className="text-xs text-amber-800 flex items-start gap-1.5"
              >
                <span className="mt-0.5 inline-block w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <span>{g.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const VerdictMetric: React.FC<{
  label: string;
  value: string;
  sub?: string;
  accent?: 'red' | 'amber';
}> = ({ label, value, sub, accent }) => (
  <div className="px-4 py-3">
    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500 mb-1">
      {label}
    </p>
    <p
      className={`text-xl font-black tabular-nums leading-tight ${
        accent === 'red'
          ? 'text-red-600'
          : accent === 'amber'
            ? 'text-amber-600'
            : 'text-slate-900'
      }`}
    >
      {value}
    </p>
    {sub && (
      <p className="text-[10px] text-slate-500 mt-0.5 truncate">{sub}</p>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// YamazumiChart — inline SVG, one bar per step. Bar height = standard time;
// bar color = VA / NVA / Wait. Red dashed line = takt. Bottleneck step is
// outlined in slate-900 so the eye lands on it first.
// ---------------------------------------------------------------------------

interface YamazumiProps {
  steps: TaktStep[];
  taktSec: number;
  bottleneckIdx: number;
}

const YamazumiChart: React.FC<YamazumiProps> = ({
  steps,
  taktSec,
  bottleneckIdx
}) => {
  if (steps.length === 0) {
    return (
      <div className="text-xs text-slate-400 py-6 text-center">
        No steps to chart.
      </div>
    );
  }
  // Fixed viewBox dimensions; SVG scales to container width via CSS.
  const W = 640;
  const H = 240;
  const padLeft = 36;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 56;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;

  const standards = steps.map((s) => stepStandardSec(s));
  const maxObserved = Math.max(...standards, taktSec);
  // 10% headroom above the tallest element so the takt label and bar caps
  // don't crash into the top edge.
  const yMax = Math.max(maxObserved * 1.1, 1);

  const yScale = (sec: number) => padTop + innerH - (sec / yMax) * innerH;
  const slot = innerW / steps.length;
  const barW = Math.min(56, slot * 0.7);

  const colorFor = (t: 'va' | 'nva' | 'wait'): string =>
    t === 'va' ? '#10b981' : t === 'nva' ? '#f59e0b' : '#94a3b8';

  // Y-axis ticks at 0%, 25%, 50%, 75%, 100% of yMax.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Yamazumi chart of step standard times versus takt"
    >
      {/* Y-axis ticks + grid lines */}
      {ticks.map((t, i) => {
        const y = yScale(t);
        return (
          <g key={i}>
            <line
              x1={padLeft}
              y1={y}
              x2={W - padRight}
              y2={y}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text
              x={padLeft - 4}
              y={y + 3}
              fontSize={9}
              textAnchor="end"
              fill="#94a3b8"
            >
              {t.toFixed(0)}s
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {steps.map((s, i) => {
        const std = standards[i];
        const x = padLeft + slot * i + (slot - barW) / 2;
        const y = yScale(std);
        const h = padTop + innerH - y;
        const overTakt = taktSec > 0 && std > taktSec;
        const isBottleneck = i === bottleneckIdx;
        const stroke = isBottleneck ? '#0f172a' : 'none';
        return (
          <g key={s.id}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(0, h)}
              fill={colorFor(s.vaType)}
              stroke={stroke}
              strokeWidth={isBottleneck ? 2 : 0}
              opacity={overTakt ? 0.9 : 0.85}
            />
            {/* Standard time label above bar */}
            <text
              x={x + barW / 2}
              y={y - 4}
              fontSize={10}
              textAnchor="middle"
              fill={overTakt ? '#dc2626' : '#0f172a'}
              fontWeight={700}
            >
              {std.toFixed(1)}s
            </text>
            {/* Step number under bar */}
            <text
              x={x + barW / 2}
              y={padTop + innerH + 14}
              fontSize={9}
              textAnchor="middle"
              fill="#64748b"
              fontWeight={700}
            >
              #{i + 1}
            </text>
            {/* Truncated step name under number */}
            <text
              x={x + barW / 2}
              y={padTop + innerH + 28}
              fontSize={9}
              textAnchor="middle"
              fill="#94a3b8"
            >
              {(s.name || '').slice(0, 14)}
            </text>
          </g>
        );
      })}

      {/* Takt line — drawn last so it sits on top of bars. */}
      {taktSec > 0 && (
        <g>
          <line
            x1={padLeft}
            y1={yScale(taktSec)}
            x2={W - padRight}
            y2={yScale(taktSec)}
            stroke="#dc2626"
            strokeDasharray="5 4"
            strokeWidth={2}
          />
          <rect
            x={W - padRight - 70}
            y={yScale(taktSec) - 18}
            width={70}
            height={14}
            fill="#dc2626"
          />
          <text
            x={W - padRight - 4}
            y={yScale(taktSec) - 8}
            fontSize={10}
            textAnchor="end"
            fill="#fff"
            fontWeight={700}
          >
            Takt {taktSec.toFixed(1)}s
          </text>
        </g>
      )}

      {/* Legend */}
      <g transform={`translate(${padLeft}, ${H - 10})`}>
        <LegendSwatch x={0} color="#10b981" label="VA" />
        <LegendSwatch x={50} color="#f59e0b" label="NVA" />
        <LegendSwatch x={110} color="#94a3b8" label="Wait" />
      </g>
    </svg>
  );
};

const LegendSwatch: React.FC<{ x: number; color: string; label: string }> = ({
  x,
  color,
  label
}) => (
  <g transform={`translate(${x}, 0)`}>
    <rect width={10} height={10} y={-9} fill={color} />
    <text x={14} y={0} fontSize={10} fill="#64748b" fontWeight={600}>
      {label}
    </text>
  </g>
);

export default TaktStudyTool;
