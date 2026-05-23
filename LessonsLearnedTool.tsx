// ---------------------------------------------------------------------------
// LessonsLearnedTool — Per-project lessons learned & recommendation tracker.
//
// Purpose: structured capture of what went wrong, what worked well, and the
// concrete actions teams should take to improve next time. Covers both product
// and process investigation in a single form.
//
// Each lesson carries:
//   • Observation / description (what happened)
//   • Root cause (guided by 5-Why / Ishikawa approach — kept as free text)
//   • Action items: each tagged MUST or NICE_TO_HAVE with owner + target date
//   • Status lifecycle: Open → In Progress → Closed
//
// Category aligns with APQP / 8D / A3 industry conventions:
//   Product, Process, Supplier, Quality, Safety, Commercial, Other.
//
// Lifecycle: always editable. Closed lessons are retained for traceability.
// Same editable posture as MeetingsTool / DecisionLedgerTool.
//
// Persistence: `lessons` Firestore collection, one doc per lesson.
// userId + projectId scoped, composite index (userId asc, projectId asc, dateMs desc).
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Lightbulb,
  Plus,
  Loader2,
  ArrowLeft,
  Save,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  X,
  Calendar,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { db, auth } from './firebase.ts';
import { logActivity } from './activityLogger.ts';
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

export type LessonCategory = 'product' | 'process' | 'supplier' | 'quality' | 'safety' | 'commercial' | 'other';
export type LessonType     = 'problem' | 'improvement' | 'best_practice';
export type LessonStatus   = 'open' | 'in_progress' | 'closed';
export type ActionPriority = 'must' | 'nice_to_have';

export interface ActionItem {
  id: string;
  text: string;          // ≤300 char
  priority: ActionPriority;
  owner: string;         // ≤80 char
  targetDateMs?: number; // UTC midnight
  done: boolean;
}

export interface Lesson {
  id: string;
  userId: string;
  projectId: string;
  dateMs: number;         // date of event/observation — UTC midnight
  title: string;          // ≤150 char, required
  category: LessonCategory;
  lessonType: LessonType;
  gate?: string;          // gate phase where this occurred
  description: string;    // what happened / observation ≤600 char, required
  rootCause: string;      // 5-Why / Ishikawa summary ≤500 char
  actionItems: ActionItem[];
  status: LessonStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TITLE_MAX       = 150;
const DESCRIPTION_MAX = 600;
const ROOT_CAUSE_MAX  = 500;
const ACTION_TEXT_MAX = 300;
const ACTION_OWNER_MAX = 80;

const GATE_OPTIONS = ['CR', 'PDR', 'CDR', 'TRR', 'PRR', 'MP'];

export const CATEGORY_LABELS: Record<LessonCategory, string> = {
  product:    'Product',
  process:    'Process',
  supplier:   'Supplier',
  quality:    'Quality',
  safety:     'Safety',
  commercial: 'Commercial',
  other:      'Other'
};

const CATEGORY_COLORS: Record<LessonCategory, string> = {
  product:    'bg-blue-50 text-blue-700 border-blue-200',
  process:    'bg-violet-50 text-violet-700 border-violet-200',
  supplier:   'bg-amber-50 text-amber-700 border-amber-200',
  quality:    'bg-rose-50 text-rose-700 border-rose-200',
  safety:     'bg-orange-50 text-orange-700 border-orange-200',
  commercial: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  other:      'bg-slate-100 text-slate-600 border-slate-200'
};

export const TYPE_LABELS: Record<LessonType, string> = {
  problem:       'Problem',
  improvement:   'Improvement',
  best_practice: 'Best Practice'
};

const TYPE_COLORS: Record<LessonType, string> = {
  problem:       'bg-red-50 text-red-700 border-red-200',
  improvement:   'bg-teal-50 text-teal-700 border-teal-200',
  best_practice: 'bg-sky-50 text-sky-700 border-sky-200'
};

const STATUS_LABELS: Record<LessonStatus, string> = {
  open:        'Open',
  in_progress: 'In Progress',
  closed:      'Closed'
};

const STATUS_COLORS: Record<LessonStatus, string> = {
  open:        'bg-red-50 text-red-700 border-red-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  closed:      'bg-emerald-50 text-emerald-700 border-emerald-200'
};

const STATUS_ICONS: Record<LessonStatus, React.ComponentType<{ size?: number; className?: string }>> = {
  open:        Circle,
  in_progress: Clock,
  closed:      CheckCircle2
};

const PRIORITY_LABELS: Record<ActionPriority, string> = {
  must:         'MUST',
  nice_to_have: 'NICE TO HAVE'
};

const PRIORITY_COLORS: Record<ActionPriority, string> = {
  must:         'bg-red-600 text-white',
  nice_to_have: 'bg-slate-200 text-slate-700'
};

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

function uid4(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const blankLesson = (projectId: string, userId: string): Lesson => ({
  id: '',
  userId,
  projectId,
  dateMs: isoToMs(todayISO()),
  title: '',
  category: 'process',
  lessonType: 'problem',
  gate: undefined,
  description: '',
  rootCause: '',
  actionItems: [],
  status: 'open'
});

const blankAction = (): ActionItem => ({
  id: uid4(),
  text: '',
  priority: 'must',
  owner: '',
  targetDateMs: undefined,
  done: false
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LessonsLearnedToolProps {
  projectId: string;
  projectName?: string;
  currentGate?: string;
  readOnly?: boolean;
}

type Mode = { kind: 'list' } | { kind: 'edit'; lesson: Lesson };

const LessonsLearnedTool: React.FC<LessonsLearnedToolProps> = ({
  projectId,
  projectName: _projectName = 'Project',
  currentGate,
  readOnly = false
}) => {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [mode,    setMode]    = useState<Mode>({ kind: 'list' });

  const uid = auth.currentUser?.uid ?? '';

  // ── Load ─────────────────────────────────────────────────────────────────

  const load = async (): Promise<Lesson[]> => {
    if (!uid || !projectId) { setLessons([]); setLoading(false); return []; }
    setLoading(true); setError(null);
    try {
      const snap = await getDocs(query(
        collection(db, 'lessons'),
        where('userId',    '==', uid),
        where('projectId', '==', projectId),
        orderBy('dateMs', 'desc')
      ));
      const loaded = snap.docs.map(d => ({ ...d.data() as Omit<Lesson, 'id'>, id: d.id }));
      setLessons(loaded);
      return loaded;
    } catch (e: any) {
      console.error('[LessonsLearnedTool] load failed', e);
      setError(e?.message ?? 'Failed to load lessons');
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [uid, projectId]); // eslint-disable-line

  // ── CRUD ──────────────────────────────────────────────────────────────────

  const save = async (l: Lesson) => {
    if (!uid) throw new Error('Not authenticated');

    // Sanitize action items before write
    const cleanActions: ActionItem[] = l.actionItems
      .filter(a => a.text.trim().length > 0)
      .map(a => ({
        id:           a.id || uid4(),
        text:         a.text.slice(0, ACTION_TEXT_MAX).trim(),
        priority:     a.priority,
        owner:        a.owner.slice(0, ACTION_OWNER_MAX).trim(),
        targetDateMs: a.targetDateMs ?? null as any,
        done:         Boolean(a.done)
      }));

    const payload: Omit<Lesson, 'id' | 'createdAt' | 'updatedAt'> & { updatedAt: any; createdAt?: any } = {
      userId:      uid,
      projectId,
      dateMs:      Number(l.dateMs) || isoToMs(todayISO()),
      title:       l.title.slice(0, TITLE_MAX).trim() || 'Untitled lesson',
      category:    l.category,
      lessonType:  l.lessonType,
      description: l.description.slice(0, DESCRIPTION_MAX),
      rootCause:   l.rootCause.slice(0, ROOT_CAUSE_MAX),
      actionItems: cleanActions,
      status:      l.status,
      updatedAt:   serverTimestamp()
    };
    if (l.gate) payload.gate = l.gate; else delete (payload as any).gate;

    const isNew = !l.id;
    if (l.id) {
      await updateDoc(doc(db, 'lessons', l.id), payload);
    } else {
      await addDoc(collection(db, 'lessons'), { ...payload, createdAt: serverTimestamp() });
    }
    await load();

    // Activity log
    const mustCount  = cleanActions.filter(a => a.priority === 'must').length;
    const niceCount  = cleanActions.filter(a => a.priority === 'nice_to_have').length;
    const detail = [
      mustCount  > 0 ? `${mustCount} MUST action${mustCount > 1 ? 's' : ''}` : '',
      niceCount  > 0 ? `${niceCount} nice-to-have` : '',
      payload.rootCause ? payload.rootCause.slice(0, 80) : ''
    ].filter(Boolean).join(' · ').slice(0, 200);

    logActivity({
      userId: uid,
      projectId,
      eventType: isNew ? 'lesson_created' : (payload.status === 'closed' ? 'lesson_closed' : 'lesson_updated'),
      tool: 'lessons',
      title: isNew
        ? `Lesson captured: ${payload.title}`
        : payload.status === 'closed'
          ? `Lesson closed: ${payload.title}`
          : `Lesson updated: ${payload.title}`,
      detail: detail || undefined,
      metadata: {
        category:   payload.category,
        lessonType: payload.lessonType,
        status:     payload.status,
        mustCount,
        niceCount
      },
      timestampMs: Date.now()
    });

    setMode({ kind: 'list' });
  };

  const remove = async (l: Lesson) => {
    if (!l.id) return;
    if (!confirm(`Delete "${l.title || 'this lesson'}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'lessons', l.id));
      logActivity({
        userId: uid,
        projectId,
        eventType: 'lesson_deleted',
        tool: 'lessons',
        title: `Lesson deleted: ${l.title || 'Untitled'}`,
        timestampMs: Date.now()
      });
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'Delete failed');
    }
  };

  // ── Summary stats ─────────────────────────────────────────────────────────

  const openCount       = lessons.filter(l => l.status === 'open').length;
  const inProgressCount = lessons.filter(l => l.status === 'in_progress').length;
  const closedCount     = lessons.filter(l => l.status === 'closed').length;
  const mustPending     = lessons.flatMap(l => l.actionItems).filter(a => a.priority === 'must' && !a.done).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-xl overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Lightbulb size={20} className="text-slate-300" />
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/70 mb-1">
              Tool · Capture, investigate &amp; act on project learnings
            </p>
            <h3 className="text-lg font-black uppercase tracking-tight leading-tight">
              Lessons &amp; Learned
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
                onClick={() => uid && setMode({ kind: 'edit', lesson: blankLesson(projectId, uid) })}
                className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow"
              >
                <Plus size={12} /> New Lesson
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
            <LessonList
              lessons={lessons}
              loading={loading}
              error={error}
              openCount={openCount}
              inProgressCount={inProgressCount}
              closedCount={closedCount}
              mustPending={mustPending}
              onOpen={(l) => setMode({ kind: 'edit', lesson: l })}
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
            <LessonForm
              initial={(mode as { kind: 'edit'; lesson: Lesson }).lesson}
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

export default LessonsLearnedTool;

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

interface LessonListProps {
  lessons: Lesson[];
  loading: boolean;
  error: string | null;
  openCount: number;
  inProgressCount: number;
  closedCount: number;
  mustPending: number;
  onOpen: (l: Lesson) => void;
  onDelete: (l: Lesson) => void;
  readOnly: boolean;
}

const LessonList: React.FC<LessonListProps> = ({
  lessons, loading, error,
  openCount, inProgressCount, closedCount, mustPending,
  onOpen, onDelete, readOnly
}) => {
  if (loading) {
    return (
      <div className="px-6 py-10 flex items-center justify-center text-slate-400 text-sm gap-2">
        <Loader2 size={14} className="animate-spin" /> Loading lessons…
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
  if (lessons.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <Lightbulb size={28} className="mx-auto text-slate-300 mb-3" />
        <p className="text-sm text-slate-500 mb-1">No lessons captured yet.</p>
        <p className="text-[11px] text-slate-400">
          Click <span className="font-semibold text-slate-600">New Lesson</span> to record the first learning.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Summary strip */}
      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/60 flex items-center gap-5 flex-wrap">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          {lessons.length} lesson{lessons.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-3">
          {openCount > 0 && (
            <span className="text-[10px] font-bold text-red-700">{openCount} open</span>
          )}
          {inProgressCount > 0 && (
            <span className="text-[10px] font-bold text-amber-700">{inProgressCount} in progress</span>
          )}
          {closedCount > 0 && (
            <span className="text-[10px] font-bold text-emerald-700">{closedCount} closed</span>
          )}
        </div>
        {mustPending > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[10px] font-black bg-red-600 text-white px-2 py-0.5">
            {mustPending} MUST action{mustPending > 1 ? 's' : ''} pending
          </span>
        )}
      </div>

      <ul className="divide-y divide-slate-100">
        {lessons.map((l) => {
          const StatusIcon   = STATUS_ICONS[l.status];
          const catColor     = CATEGORY_COLORS[l.category] ?? CATEGORY_COLORS.other;
          const typeColor    = TYPE_COLORS[l.lessonType]   ?? TYPE_COLORS.problem;
          const statusColor  = STATUS_COLORS[l.status];
          const mustCount    = l.actionItems.filter(a => a.priority === 'must').length;
          const mustDone     = l.actionItems.filter(a => a.priority === 'must' && a.done).length;
          const niceCount    = l.actionItems.filter(a => a.priority === 'nice_to_have').length;

          return (
            <li key={l.id} className="px-6 py-4 flex items-start gap-4 hover:bg-slate-50 transition-colors">
              <button type="button" onClick={() => onOpen(l)} className="flex-1 text-left min-w-0">
                {/* Row 1: meta chips */}
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500 tabular-nums">
                    {fmtDate(l.dateMs)}
                  </span>
                  {l.gate && (
                    <span className="border border-slate-200 bg-slate-100 text-slate-600 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">
                      {l.gate}
                    </span>
                  )}
                  <span className={`inline-flex items-center border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${catColor}`}>
                    {CATEGORY_LABELS[l.category]}
                  </span>
                  <span className={`inline-flex items-center border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${typeColor}`}>
                    {TYPE_LABELS[l.lessonType]}
                  </span>
                  <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${statusColor}`}>
                    <StatusIcon size={9} />
                    {STATUS_LABELS[l.status]}
                  </span>
                </div>

                {/* Row 2: title */}
                <p className="text-sm font-bold truncate text-slate-900">
                  {l.title || 'Untitled lesson'}
                </p>

                {/* Row 3: root cause preview + action badges */}
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {l.rootCause && (
                    <span className="text-[11px] text-slate-400 line-clamp-1 italic max-w-[300px]">
                      Root cause: {l.rootCause}
                    </span>
                  )}
                  {mustCount > 0 && (
                    <span className="text-[10px] font-black bg-red-600 text-white px-1.5 py-0.5 shrink-0">
                      {mustDone}/{mustCount} MUST
                    </span>
                  )}
                  {niceCount > 0 && (
                    <span className="text-[10px] font-bold text-slate-500 border border-slate-200 px-1.5 py-0.5 shrink-0">
                      +{niceCount} nice-to-have
                    </span>
                  )}
                </div>
              </button>

              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onDelete(l)}
                  title="Delete lesson"
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

interface LessonFormProps {
  initial: Lesson;
  currentGate?: string;
  onCancel: () => void;
  onSave: (l: Lesson) => Promise<void>;
  readOnly: boolean;
}

const LessonForm: React.FC<LessonFormProps> = ({
  initial, currentGate, onCancel, onSave, readOnly
}) => {
  const [draft,     setDraft]     = useState<Lesson>(() => ({
    ...initial,
    gate: initial.gate ?? currentGate ?? undefined,
    actionItems: initial.actionItems.length > 0 ? initial.actionItems : []
  }));
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showRootCauseGuide, setShowRootCauseGuide] = useState(false);

  const isNew   = !initial.id;
  const canSave = draft.title.trim().length > 0 && draft.description.trim().length > 0 && !readOnly && !saving;
  const set     = (patch: Partial<Lesson>) => setDraft(p => ({ ...p, ...patch }));

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true); setSaveError(null);
    try { await onSave(draft); }
    catch (e: any) { setSaveError(e?.message ?? 'Save failed'); setSaving(false); }
  };

  // ── Action items CRUD ────────────────────────────────────────────────────

  const addAction = () => {
    set({ actionItems: [...draft.actionItems, blankAction()] });
  };

  const updateAction = (id: string, patch: Partial<ActionItem>) => {
    set({
      actionItems: draft.actionItems.map(a => a.id === id ? { ...a, ...patch } : a)
    });
  };

  const removeAction = (id: string) => {
    set({ actionItems: draft.actionItems.filter(a => a.id !== id) });
  };

  const mustCount = draft.actionItems.filter(a => a.priority === 'must').length;
  const niceCount = draft.actionItems.filter(a => a.priority === 'nice_to_have').length;

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
          {isNew ? 'New lesson' : 'Edit lesson'}
        </span>
      </div>

      {/* Row 1: Date · Gate · Category · Type · Status */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Date</label>
          <input
            type="date"
            value={msToISO(draft.dateMs)}
            onChange={e => set({ dateMs: isoToMs(e.target.value) })}
            disabled={readOnly}
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-teal-500 focus:outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Gate / Phase</label>
          <select
            value={draft.gate ?? ''}
            onChange={e => set({ gate: e.target.value || undefined })}
            disabled={readOnly}
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-teal-500 focus:outline-none disabled:bg-slate-50 bg-white"
          >
            <option value="">— Not specified —</option>
            {GATE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Category</label>
          <select
            value={draft.category}
            onChange={e => set({ category: e.target.value as LessonCategory })}
            disabled={readOnly}
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-teal-500 focus:outline-none disabled:bg-slate-50 bg-white"
          >
            {(Object.keys(CATEGORY_LABELS) as LessonCategory[]).map(k => (
              <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Type</label>
          <select
            value={draft.lessonType}
            onChange={e => set({ lessonType: e.target.value as LessonType })}
            disabled={readOnly}
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-teal-500 focus:outline-none disabled:bg-slate-50 bg-white"
          >
            <option value="problem">Problem</option>
            <option value="improvement">Improvement</option>
            <option value="best_practice">Best Practice</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Status</label>
          <select
            value={draft.status}
            onChange={e => set({ status: e.target.value as LessonStatus })}
            disabled={readOnly}
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-teal-500 focus:outline-none disabled:bg-slate-50 bg-white"
          >
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
          Lesson Title <span className="text-red-400 ml-0.5">*</span>
        </label>
        <input
          type="text"
          value={draft.title}
          maxLength={TITLE_MAX}
          onChange={e => set({ title: e.target.value })}
          disabled={readOnly}
          placeholder="e.g. 'Supplier qualification gaps caused late-stage yield drop'"
          className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-teal-500 focus:outline-none disabled:bg-slate-50"
        />
        <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
          {draft.title.length} / {TITLE_MAX}
        </div>
      </div>

      {/* What happened */}
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
          What Happened <span className="text-red-400 ml-0.5">*</span>
        </label>
        <textarea
          value={draft.description}
          maxLength={DESCRIPTION_MAX}
          onChange={e => set({ description: e.target.value })}
          disabled={readOnly}
          rows={4}
          placeholder="Describe the event or observation. Be specific — what was expected vs. what actually happened, where in the process, what was the impact."
          className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-teal-500 focus:outline-none disabled:bg-slate-50 resize-y leading-relaxed"
        />
        <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
          {draft.description.length} / {DESCRIPTION_MAX}
        </div>
      </div>

      {/* Root cause */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
            Root Cause
          </label>
          <button
            type="button"
            onClick={() => setShowRootCauseGuide(v => !v)}
            className="text-[10px] font-bold text-teal-600 hover:text-teal-800 flex items-center gap-1 transition-colors"
          >
            {showRootCauseGuide ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            5-Why guide
          </button>
        </div>

        {showRootCauseGuide && (
          <div className="mb-2 p-3 bg-teal-50 border border-teal-200 text-[11px] text-teal-800 leading-relaxed">
            <p className="font-bold mb-1">5-Why approach</p>
            <p className="mb-1">Ask "Why?" repeatedly until you reach the systemic root, not just the symptom:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-teal-700">
              <li>Why did the problem occur?</li>
              <li>Why did that happen?</li>
              <li>Why? (repeat until you hit process, training, or system gaps)</li>
            </ol>
            <p className="mt-1 text-teal-600">For complex failures, consider an Ishikawa (fishbone) diagram offline and summarize the findings here.</p>
          </div>
        )}

        <textarea
          value={draft.rootCause}
          maxLength={ROOT_CAUSE_MAX}
          onChange={e => set({ rootCause: e.target.value })}
          disabled={readOnly}
          rows={3}
          placeholder="Summarize the root cause — systemic gaps, process missing steps, training issues, supplier management, design assumptions…"
          className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-teal-500 focus:outline-none disabled:bg-slate-50 resize-y leading-relaxed"
        />
        <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
          {draft.rootCause.length} / {ROOT_CAUSE_MAX}
        </div>
      </div>

      {/* Action items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
              Recommendations &amp; Actions
            </label>
            {(mustCount > 0 || niceCount > 0) && (
              <p className="text-[10px] text-slate-400 mt-0.5">
                {mustCount > 0 && <span className="font-bold text-red-600">{mustCount} MUST</span>}
                {mustCount > 0 && niceCount > 0 && <span className="text-slate-400"> · </span>}
                {niceCount > 0 && <span className="font-bold text-slate-500">{niceCount} nice-to-have</span>}
              </p>
            )}
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={addAction}
              className="text-[10px] font-black uppercase tracking-widest text-teal-600 hover:text-teal-800 border border-teal-300 hover:border-teal-500 px-3 py-1.5 flex items-center gap-1.5 transition-colors"
            >
              <Plus size={11} /> Add action
            </button>
          )}
        </div>

        {draft.actionItems.length === 0 ? (
          <div className="border border-dashed border-slate-300 px-4 py-6 text-center">
            <p className="text-[12px] text-slate-400">
              No actions yet.{' '}
              {!readOnly && (
                <button
                  type="button"
                  onClick={addAction}
                  className="text-teal-600 font-semibold hover:underline"
                >
                  Add one
                </button>
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {draft.actionItems.map((action, idx) => (
              <ActionItemRow
                key={action.id}
                index={idx}
                action={action}
                onChange={(patch) => updateAction(action.id, patch)}
                onRemove={() => removeAction(action.id)}
                readOnly={readOnly}
              />
            ))}
          </div>
        )}
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
          Title and "What Happened" are required. Root cause and actions are strongly recommended.
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
              className="bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-5 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {saving ? 'Saving…' : isNew ? 'Save Lesson' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ActionItemRow — inline editable row inside the form
// ---------------------------------------------------------------------------

interface ActionItemRowProps {
  index: number;
  action: ActionItem;
  onChange: (patch: Partial<ActionItem>) => void;
  onRemove: () => void;
  readOnly: boolean;
}

const ActionItemRow: React.FC<ActionItemRowProps> = ({ index, action, onChange, onRemove, readOnly }) => {
  return (
    <div className={`border rounded-sm p-3 ${action.done ? 'bg-slate-50 opacity-70' : 'bg-white'} ${
      action.priority === 'must' ? 'border-red-200' : 'border-slate-200'
    }`}>
      <div className="flex items-start gap-3">
        {/* Done toggle */}
        <button
          type="button"
          onClick={() => !readOnly && onChange({ done: !action.done })}
          disabled={readOnly}
          className="mt-0.5 shrink-0"
          title={action.done ? 'Mark incomplete' : 'Mark done'}
        >
          {action.done
            ? <CheckCircle2 size={16} className="text-emerald-500" />
            : <Circle size={16} className="text-slate-300 hover:text-slate-500" />
          }
        </button>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={action.text}
            maxLength={ACTION_TEXT_MAX}
            onChange={e => onChange({ text: e.target.value })}
            disabled={readOnly}
            placeholder={`Action ${index + 1} — what needs to happen`}
            className={`w-full text-sm font-medium text-slate-900 border-0 border-b border-slate-200 focus:border-teal-400 focus:outline-none pb-0.5 bg-transparent ${action.done ? 'line-through text-slate-400' : ''}`}
          />
        </div>

        {/* Priority toggle */}
        <button
          type="button"
          onClick={() => !readOnly && onChange({ priority: action.priority === 'must' ? 'nice_to_have' : 'must' })}
          disabled={readOnly}
          className={`shrink-0 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-sm transition-colors ${PRIORITY_COLORS[action.priority]}`}
          title="Toggle MUST / Nice to have"
        >
          {PRIORITY_LABELS[action.priority]}
        </button>

        {/* Remove */}
        {!readOnly && (
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 text-slate-300 hover:text-red-500 transition-colors mt-0.5"
            title="Remove action"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Owner + Target date */}
      <div className="flex items-center gap-3 mt-2 pl-7">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">Owner</span>
          <input
            type="text"
            value={action.owner}
            maxLength={ACTION_OWNER_MAX}
            onChange={e => onChange({ owner: e.target.value })}
            disabled={readOnly}
            placeholder="Name or team"
            className="flex-1 text-[12px] text-slate-700 border-0 border-b border-slate-200 focus:border-teal-400 focus:outline-none pb-0.5 bg-transparent min-w-0"
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Calendar size={11} className="text-slate-400" />
          <input
            type="date"
            value={action.targetDateMs ? msToISO(action.targetDateMs) : ''}
            onChange={e => onChange({ targetDateMs: e.target.value ? isoToMs(e.target.value) : undefined })}
            disabled={readOnly}
            className="text-[12px] text-slate-700 border-0 border-b border-slate-200 focus:border-teal-400 focus:outline-none pb-0.5 bg-transparent w-32"
            title="Target date"
          />
        </div>
      </div>
    </div>
  );
};
