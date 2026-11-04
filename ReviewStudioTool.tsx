// ---------------------------------------------------------------------------
// ReviewStudioTool.tsx — Design Review log + Gate/Design Review Package generator.
//
// Two internal tabs:
//   1. Design Reviews  — structured log of design reviews (DR, TRR, CDR, PRR…)
//                        with review items (pass/fail), outcome, action items.
//   2. Review Package  — one-click PPTX deck compiled from all project tool data.
//
// Firestore collection: designReviews  (userId + projectId scoped, always editable)
// Composite index: (userId asc, projectId asc, dateMs desc)
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Presentation, Plus, Trash2, ChevronDown, ChevronUp,
  CheckCircle2, Circle, XCircle, Clock, ArrowLeft,
  FileDown, Loader2, AlertCircle, CheckCheck, MinusCircle,
  Users, CalendarDays, Clipboard
} from 'lucide-react';
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs,
  doc, query, where, orderBy, Timestamp, serverTimestamp
} from 'firebase/firestore';
import { db, auth } from './firebase.ts';
import { logActivity } from './activityLogger.ts';
import type { ProductGate } from './ProjectDeepDive.tsx';
import { generateAndDownloadReviewPackage } from './utils/reviewPackagePptx.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type ReviewType =
  | 'design_review'
  | 'preliminary_design'
  | 'test_readiness'
  | 'gate_review'
  | 'production_readiness'
  | 'other';

export type ReviewOutcome =
  | 'pending'
  | 'approved'
  | 'approved_with_conditions'
  | 'needs_rework'
  | 'rejected';

export type ReviewItemStatus = 'pass' | 'fail' | 'open' | 'waived';

export interface ReviewItem {
  id: string;
  description: string;
  status: ReviewItemStatus;
  comments: string;
}

export interface ReviewAction {
  id: string;
  text: string;
  owner: string;
  targetDateMs?: number;
  done: boolean;
  priority: 'must' | 'nice_to_have';
}

export interface DesignReview {
  id: string;
  userId: string;
  projectId: string;
  reviewType: ReviewType;
  title: string;
  gate?: ProductGate;
  dateMs: number;
  chairperson: string;
  attendees: string;
  objectives: string;
  reviewItems: ReviewItem[];
  actionItems: ReviewAction[];
  outcome: ReviewOutcome;
  notes: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  design_review:       'Design Review',
  preliminary_design:  'Preliminary Design Review (PDR)',
  test_readiness:      'Test Readiness Review (TRR)',
  gate_review:         'Gate Review',
  production_readiness:'Production Readiness Review (PRR)',
  other:               'Other',
};

const OUTCOME_LABELS: Record<ReviewOutcome, string> = {
  pending:                 'Pending',
  approved:                'Approved',
  approved_with_conditions:'Approved with Conditions',
  needs_rework:            'Needs Rework',
  rejected:                'Rejected',
};

const OUTCOME_STYLES: Record<ReviewOutcome, string> = {
  pending:                 'bg-slate-100 text-slate-500 border-slate-200',
  approved:                'bg-emerald-50 text-emerald-700 border-emerald-200',
  approved_with_conditions:'bg-amber-50 text-amber-700 border-amber-200',
  needs_rework:            'bg-orange-50 text-orange-700 border-orange-200',
  rejected:                'bg-rose-50 text-rose-700 border-rose-200',
};

const ITEM_STATUS_ICONS: Record<ReviewItemStatus, React.ReactNode> = {
  pass:   <CheckCircle2 size={14} className="text-emerald-500" />,
  fail:   <XCircle      size={14} className="text-rose-500" />,
  open:   <Clock        size={14} className="text-amber-500" />,
  waived: <MinusCircle  size={14} className="text-slate-400" />,
};

const GATE_OPTIONS: ProductGate[] = ['CR', 'PDR', 'CDR', 'TRR', 'PRR', 'MP'];

function utcToday(): string {
  return new Date().toISOString().split('T')[0];
}

function dateFromMs(ms: number): string {
  return new Date(ms).toISOString().split('T')[0];
}

function msFromDate(d: string): number {
  return new Date(d + 'T00:00:00Z').getTime();
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ReviewStudioToolProps {
  projectId: string;
  projectName: string;
  currentGate?: ProductGate;
  /** Full project object — forwarded to the PPTX generator for scores/metadata */
  project: any;
  /** Pre-computed group scores from ProjectDeepDive */
  groupScores: Record<string, number>;
  /** Overall RAMP % */
  overall: number;
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// ReviewItemRow sub-component
// ---------------------------------------------------------------------------
function ReviewItemRow({
  item,
  onChange,
  onDelete,
}: {
  item: ReviewItem;
  onChange: (item: ReviewItem) => void;
  onDelete: () => void;
}) {
  const statuses: ReviewItemStatus[] = ['pass', 'fail', 'open', 'waived'];
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-slate-100 last:border-0 group">
      {/* Status cycle */}
      <button
        className="mt-0.5 flex-shrink-0"
        onClick={() => {
          const idx = statuses.indexOf(item.status);
          onChange({ ...item, status: statuses[(idx + 1) % statuses.length] });
        }}
        title="Click to cycle status"
      >
        {ITEM_STATUS_ICONS[item.status]}
      </button>

      {/* Description + comments */}
      <div className="flex-1 min-w-0">
        <input
          className="w-full text-[12px] font-medium text-slate-800 bg-transparent border-b border-transparent focus:border-slate-200 focus:outline-none pb-0.5"
          placeholder="Review item description…"
          maxLength={200}
          value={item.description}
          onChange={e => onChange({ ...item, description: e.target.value })}
        />
        <input
          className="w-full text-[11px] text-slate-400 bg-transparent border-b border-transparent focus:border-slate-200 focus:outline-none mt-0.5 pb-0.5"
          placeholder="Comments (optional)…"
          maxLength={200}
          value={item.comments}
          onChange={e => onChange({ ...item, comments: e.target.value })}
        />
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-rose-400 mt-1"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewActionRow sub-component
// ---------------------------------------------------------------------------
function ReviewActionRow({
  action,
  onChange,
  onDelete,
}: {
  action: ReviewAction;
  onChange: (a: ReviewAction) => void;
  onDelete: () => void;
}) {
  return (
    <div className={`flex items-start gap-2 p-2 rounded border mb-1.5 group ${
      action.priority === 'must'
        ? 'border-rose-200 bg-rose-50/50'
        : 'border-slate-200 bg-slate-50/50'
    }`}>
      {/* Done toggle */}
      <button
        className="mt-0.5 flex-shrink-0"
        onClick={() => onChange({ ...action, done: !action.done })}
      >
        {action.done
          ? <CheckCircle2 size={14} className="text-emerald-500" />
          : <Circle size={14} className="text-slate-300" />}
      </button>

      <div className="flex-1 min-w-0">
        <input
          className={`w-full text-[12px] font-medium bg-transparent border-b border-transparent focus:border-slate-200 focus:outline-none pb-0.5 ${
            action.done ? 'line-through text-slate-400' : 'text-slate-800'
          }`}
          placeholder="Action item…"
          maxLength={300}
          value={action.text}
          onChange={e => onChange({ ...action, text: e.target.value })}
        />
        <div className="flex gap-2 mt-1">
          <input
            className="text-[11px] text-slate-400 bg-transparent w-24 border-b border-transparent focus:border-slate-200 focus:outline-none pb-0.5"
            placeholder="Owner"
            maxLength={80}
            value={action.owner}
            onChange={e => onChange({ ...action, owner: e.target.value })}
          />
          <input
            type="date"
            className="text-[11px] text-slate-400 bg-transparent border-b border-transparent focus:border-slate-200 focus:outline-none pb-0.5"
            value={action.targetDateMs ? dateFromMs(action.targetDateMs) : ''}
            onChange={e => onChange({
              ...action,
              targetDateMs: e.target.value ? msFromDate(e.target.value) : undefined
            })}
          />
        </div>
      </div>

      {/* Priority toggle */}
      <button
        onClick={() => onChange({ ...action, priority: action.priority === 'must' ? 'nice_to_have' : 'must' })}
        className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border flex-shrink-0 ${
          action.priority === 'must'
            ? 'bg-rose-100 text-rose-600 border-rose-200'
            : 'bg-slate-100 text-slate-400 border-slate-200'
        }`}
        title="Toggle priority"
      >
        {action.priority === 'must' ? 'MUST' : 'NICE'}
      </button>

      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-rose-400 mt-1"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewCard — list row
// ---------------------------------------------------------------------------
function ReviewCard({
  review,
  onOpen,
  onDelete,
}: {
  review: DesignReview;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const mustTotal = review.actionItems.filter(a => a.priority === 'must').length;
  const mustDone  = review.actionItems.filter(a => a.priority === 'must' && a.done).length;
  const failCount = review.reviewItems.filter(i => i.status === 'fail').length;

  return (
    <div
      className="bg-white border border-slate-200 rounded-lg p-4 hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer group"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">
              {fmtDate(review.dateMs)}
            </span>
            {review.gate && (
              <span className="text-[9px] font-black uppercase tracking-widest bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded">
                {review.gate}
              </span>
            )}
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
              {REVIEW_TYPE_LABELS[review.reviewType].split('(')[0].trim()}
            </span>
            <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${OUTCOME_STYLES[review.outcome]}`}>
              {OUTCOME_LABELS[review.outcome]}
            </span>
          </div>
          <p className="text-[13px] font-semibold text-slate-900 leading-snug truncate">{review.title}</p>
          {review.objectives && (
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">{review.objectives}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            {review.reviewItems.length > 0 && (
              <span className="text-[10px] text-slate-500 flex items-center gap-1">
                <Clipboard size={10} />
                {review.reviewItems.length} items
                {failCount > 0 && (
                  <span className="text-rose-500 font-bold"> · {failCount} fail</span>
                )}
              </span>
            )}
            {mustTotal > 0 && (
              <span className={`text-[10px] font-semibold flex items-center gap-1 ${
                mustDone < mustTotal ? 'text-rose-500' : 'text-emerald-600'
              }`}>
                <CheckCheck size={10} />
                {mustDone}/{mustTotal} MUST done
              </span>
            )}
            {review.chairperson && (
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <Users size={10} />
                {review.chairperson}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-rose-400 p-1"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewForm
// ---------------------------------------------------------------------------
function ReviewForm({
  initial,
  projectId,
  onSave,
  onCancel,
  readOnly,
}: {
  initial: Partial<DesignReview>;
  projectId: string;
  onSave: (r: DesignReview) => void;
  onCancel: () => void;
  readOnly?: boolean;
}) {
  const isNew = !initial.id;

  const [reviewType, setReviewType] = useState<ReviewType>(initial.reviewType ?? 'design_review');
  const [title, setTitle] = useState(initial.title ?? '');
  const [gate, setGate] = useState<ProductGate | ''>(initial.gate ?? '');
  const [dateStr, setDateStr] = useState(initial.dateMs ? dateFromMs(initial.dateMs) : utcToday());
  const [chairperson, setChairperson] = useState(initial.chairperson ?? '');
  const [attendees, setAttendees] = useState(initial.attendees ?? '');
  const [objectives, setObjectives] = useState(initial.objectives ?? '');
  const [outcome, setOutcome] = useState<ReviewOutcome>(initial.outcome ?? 'pending');
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>(initial.reviewItems ?? []);
  const [actionItems, setActionItems] = useState<ReviewAction[]>(initial.actionItems ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSave = title.trim().length > 0;

  function addReviewItem() {
    setReviewItems(prev => [...prev, { id: newId(), description: '', status: 'open', comments: '' }]);
  }

  function addActionItem() {
    setActionItems(prev => [...prev, { id: newId(), text: '', owner: '', done: false, priority: 'must' }]);
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const uid = auth.currentUser?.uid ?? '';

    const payload: Omit<DesignReview, 'id'> = {
      userId: uid,
      projectId,
      reviewType,
      title: title.trim(),
      gate: gate || undefined,
      dateMs: msFromDate(dateStr),
      chairperson: chairperson.trim(),
      attendees: attendees.trim(),
      objectives: objectives.trim(),
      outcome,
      reviewItems,
      actionItems,
      notes: notes.trim(),
    };

    try {
      if (isNew) {
        const ref = await addDoc(collection(db, 'designReviews'), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        onSave({ ...payload, id: ref.id });
        logActivity({
          userId: uid, projectId,
          eventType: 'design_review_created',
          tool: 'design_review',
          title: `Design review logged: ${payload.title}`,
          detail: `Type: ${REVIEW_TYPE_LABELS[reviewType]} · Outcome: ${OUTCOME_LABELS[outcome]}`,
          timestampMs: Date.now(),
        });
      } else {
        await updateDoc(doc(db, 'designReviews', initial.id!), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
        onSave({ ...payload, id: initial.id! });
        logActivity({
          userId: uid, projectId,
          eventType: 'design_review_updated',
          tool: 'design_review',
          title: `Design review updated: ${payload.title}`,
          detail: `Outcome: ${OUTCOME_LABELS[outcome]} · ${reviewItems.length} items · ${actionItems.filter(a=>a.priority==='must'&&!a.done).length} open MUST actions`,
          timestampMs: Date.now(),
        });
      }
    } catch (e: any) {
      setError(e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700 transition-colors">
          <ArrowLeft size={16} />
        </button>
        <h3 className="text-[13px] font-black uppercase tracking-widest text-slate-700">
          {isNew ? 'New Design Review' : 'Edit Design Review'}
        </h3>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-center gap-2">
          <AlertCircle size={14} className="text-rose-500 flex-shrink-0" />
          <p className="text-[11px] text-rose-700">{error}</p>
        </div>
      )}

      {/* Core fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Review type */}
        <div>
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Review Type</label>
          <select
            className="w-full text-[12px] font-semibold text-slate-700 bg-white border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-sky-400"
            value={reviewType}
            onChange={e => setReviewType(e.target.value as ReviewType)}
            disabled={readOnly}
          >
            {(Object.entries(REVIEW_TYPE_LABELS) as [ReviewType, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>

        {/* Gate */}
        <div>
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Gate (Optional)</label>
          <select
            className="w-full text-[12px] font-semibold text-slate-700 bg-white border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-sky-400"
            value={gate}
            onChange={e => setGate(e.target.value as ProductGate | '')}
            disabled={readOnly}
          >
            <option value="">— Not gate-bound —</option>
            {GATE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        {/* Date */}
        <div>
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Review Date</label>
          <input
            type="date"
            className="w-full text-[12px] text-slate-700 bg-white border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-sky-400"
            value={dateStr}
            onChange={e => setDateStr(e.target.value)}
            disabled={readOnly}
          />
        </div>

        {/* Outcome */}
        <div>
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Outcome</label>
          <select
            className="w-full text-[12px] font-semibold text-slate-700 bg-white border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-sky-400"
            value={outcome}
            onChange={e => setOutcome(e.target.value as ReviewOutcome)}
            disabled={readOnly}
          >
            {(Object.entries(OUTCOME_LABELS) as [ReviewOutcome, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">
          Title <span className="text-rose-400">*</span>
        </label>
        <input
          className="w-full text-[13px] font-semibold text-slate-800 bg-white border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-sky-400"
          placeholder="e.g. CDR — Catheter Sub-Assembly Design Review"
          maxLength={150}
          value={title}
          onChange={e => setTitle(e.target.value)}
          disabled={readOnly}
        />
        <div className="text-right text-[9px] text-slate-300 mt-0.5">{title.length}/150</div>
      </div>

      {/* Objectives */}
      <div>
        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Objectives / Scope</label>
        <textarea
          className="w-full text-[12px] text-slate-700 bg-white border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-sky-400 resize-none"
          rows={2}
          maxLength={500}
          placeholder="What is being reviewed and what decisions are expected…"
          value={objectives}
          onChange={e => setObjectives(e.target.value)}
          disabled={readOnly}
        />
        <div className="text-right text-[9px] text-slate-300 mt-0.5">{objectives.length}/500</div>
      </div>

      {/* Chairperson + Attendees */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Chairperson</label>
          <input
            className="w-full text-[12px] text-slate-700 bg-white border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-sky-400"
            placeholder="Name"
            maxLength={100}
            value={chairperson}
            onChange={e => setChairperson(e.target.value)}
            disabled={readOnly}
          />
        </div>
        <div>
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Attendees</label>
          <input
            className="w-full text-[12px] text-slate-700 bg-white border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-sky-400"
            placeholder="Names or roles, comma-separated"
            maxLength={500}
            value={attendees}
            onChange={e => setAttendees(e.target.value)}
            disabled={readOnly}
          />
        </div>
      </div>

      {/* Review Items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Review Items</label>
          {!readOnly && (
            <button
              onClick={addReviewItem}
              className="text-[9px] font-bold uppercase tracking-widest text-sky-600 hover:text-sky-700 flex items-center gap-1"
            >
              <Plus size={10} /> Add Item
            </button>
          )}
        </div>
        {reviewItems.length === 0
          ? <p className="text-[11px] text-slate-300 italic">No items yet — add topics to review (BOM, test plan, PFMEA, drawings…)</p>
          : (
            <div className="bg-slate-50 border border-slate-200 rounded px-3 py-1">
              {reviewItems.map((item, i) => (
                <ReviewItemRow
                  key={item.id}
                  item={item}
                  onChange={updated => setReviewItems(prev => prev.map((x, j) => j === i ? updated : x))}
                  onDelete={() => setReviewItems(prev => prev.filter((_, j) => j !== i))}
                />
              ))}
            </div>
          )
        }
      </div>

      {/* Action Items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Action Items</label>
          {!readOnly && (
            <button
              onClick={addActionItem}
              className="text-[9px] font-bold uppercase tracking-widest text-sky-600 hover:text-sky-700 flex items-center gap-1"
            >
              <Plus size={10} /> Add Action
            </button>
          )}
        </div>
        {actionItems.length === 0
          ? <p className="text-[11px] text-slate-300 italic">No actions yet</p>
          : actionItems.map((a, i) => (
            <ReviewActionRow
              key={a.id}
              action={a}
              onChange={updated => setActionItems(prev => prev.map((x, j) => j === i ? updated : x))}
              onDelete={() => setActionItems(prev => prev.filter((_, j) => j !== i))}
            />
          ))
        }
      </div>

      {/* Notes */}
      <div>
        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Notes</label>
        <textarea
          className="w-full text-[12px] text-slate-700 bg-white border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-sky-400 resize-none"
          rows={3}
          maxLength={800}
          placeholder="Additional context, follow-up items, links to reference documents…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          disabled={readOnly}
        />
        <div className="text-right text-[9px] text-slate-300 mt-0.5">{notes.length}/800</div>
      </div>

      {/* Footer */}
      {!readOnly && (
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <button onClick={onCancel} className="text-[11px] text-slate-400 hover:text-slate-600">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="bg-sky-600 text-white text-[11px] font-black uppercase tracking-widest px-5 py-2 rounded hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            {saving ? 'Saving…' : isNew ? 'Log Review' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PackageGenerator — PPTX generation tab
// ---------------------------------------------------------------------------
function PackageGenerator({
  project,
  projectId,
  projectName,
  currentGate,
  groupScores,
  overall,
}: {
  project: any;
  projectId: string;
  projectName: string;
  currentGate?: ProductGate;
  groupScores: Record<string, number>;
  overall: number;
}) {
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [lastGenerated, setLastGenerated] = useState<Date | null>(null);

  const SLIDES_DESCRIBED = [
    { icon: '1', label: 'Cover', desc: 'Project name, gate, date, overall RAMP score' },
    { icon: '2', label: 'Program Status', desc: 'RAMP group scores by domain + AI status snapshot' },
    { icon: '3', label: 'Top Risks', desc: 'PFMEA — top risks by RPN with tier and action' },
    { icon: '4', label: 'Key Decisions', desc: 'Active decisions + any reversed (instability signals)' },
    { icon: '5', label: 'BOM / ECO Status', desc: 'Latest revision, supplier swaps, reason for change' },
    { icon: '6', label: 'Manufacturing Readiness', desc: 'Takt verdict, capacity %, bottleneck step' },
    { icon: '7', label: 'Budget Overview', desc: 'Planned vs actual, variance %, by category' },
    { icon: '8', label: 'Open Actions', desc: 'MUST actions from Design Reviews, Meetings & Lessons' },
    { icon: '9', label: 'Next Steps', desc: 'AI top actions from last Analysis run' },
  ];

  async function handleGenerate() {
    setGenerating(true);
    setError('');
    setStatus('Fetching project data…');
    try {
      await generateAndDownloadReviewPackage({
        db,
        userId: auth.currentUser?.uid ?? '',
        projectId,
        projectName,
        currentGate,
        project,
        groupScores,
        overall,
        onStatus: setStatus,
      });
      setLastGenerated(new Date());
      setStatus('');
      logActivity({
        userId: auth.currentUser?.uid ?? '',
        projectId,
        eventType: 'review_package_generated',
        tool: 'design_review',
        title: `Review package generated for ${projectName}`,
        detail: `Gate: ${currentGate ?? 'N/A'} · RAMP Score: ${overall}%`,
        timestampMs: Date.now(),
      });
    } catch (e: any) {
      setError(e.message ?? 'Generation failed');
      setStatus('');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* What's included */}
      <div>
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mb-3">What's Included</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SLIDES_DESCRIBED.map(s => (
            <div key={s.label} className="flex items-start gap-2.5 bg-white border border-slate-200 rounded px-3 py-2.5">
              <span className="w-5 h-5 rounded bg-sky-600 text-white text-[9px] font-black flex items-center justify-center flex-shrink-0 mt-0.5">
                {s.icon}
              </span>
              <div>
                <p className="text-[11px] font-bold text-slate-800">{s.label}</p>
                <p className="text-[10px] text-slate-400 leading-snug">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Current context */}
      <div className="bg-slate-50 border border-slate-200 rounded px-4 py-3">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Package Context</p>
        <div className="flex flex-wrap gap-4">
          <div>
            <p className="text-[9px] text-slate-400">Project</p>
            <p className="text-[12px] font-bold text-slate-800">{projectName}</p>
          </div>
          <div>
            <p className="text-[9px] text-slate-400">Gate</p>
            <p className="text-[12px] font-bold text-slate-800">{currentGate ?? '—'}</p>
          </div>
          <div>
            <p className="text-[9px] text-slate-400">RAMP Score</p>
            <p className={`text-[12px] font-bold ${
              overall >= 70 ? 'text-emerald-600' : overall >= 40 ? 'text-amber-600' : 'text-rose-600'
            }`}>{overall}%</p>
          </div>
          <div>
            <p className="text-[9px] text-slate-400">Date</p>
            <p className="text-[12px] font-bold text-slate-800">
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-center gap-2">
          <AlertCircle size={14} className="text-rose-500 flex-shrink-0" />
          <p className="text-[11px] text-rose-700">{error}</p>
        </div>
      )}

      {lastGenerated && !error && (
        <div className="bg-emerald-50 border border-emerald-200 rounded px-3 py-2 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
          <p className="text-[11px] text-emerald-700">
            Package downloaded · {lastGenerated.toLocaleTimeString()}
          </p>
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={generating}
        className="w-full bg-sky-600 text-white font-black uppercase tracking-widest text-[11px] px-6 py-3.5 rounded hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 transition-colors shadow-sm"
      >
        {generating
          ? <><Loader2 size={14} className="animate-spin" /> {status || 'Generating…'}</>
          : <><FileDown size={14} /> Generate Review Package (.pptx)</>
        }
      </button>
      <p className="text-[10px] text-slate-400 text-center -mt-4">
        Pulls live data from PFMEA, Decisions, ECO Pulse, Takt, Budget, Meetings & Lessons
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main: ReviewStudioTool
// ---------------------------------------------------------------------------
export default function ReviewStudioTool({
  projectId,
  projectName,
  currentGate,
  project,
  groupScores,
  overall,
  readOnly,
}: ReviewStudioToolProps) {
  const [activeTab, setActiveTab] = useState<'reviews' | 'package'>('reviews');
  const [reviews, setReviews] = useState<DesignReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editingReview, setEditingReview] = useState<DesignReview | null>(null);

  // Load design reviews
  useEffect(() => {
    if (!projectId) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    setLoading(true);
    const q = query(
      collection(db, 'designReviews'),
      where('userId', '==', uid),
      where('projectId', '==', projectId),
      orderBy('dateMs', 'desc')
    );
    getDocs(q)
      .then(snap => {
        setReviews(snap.docs.map(d => ({ id: d.id, ...d.data() } as DesignReview)));
      })
      .catch(err => console.warn('[ReviewStudio] load error', err))
      .finally(() => setLoading(false));
  }, [projectId]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this design review?')) return;
    const uid = auth.currentUser?.uid ?? '';
    try {
      await deleteDoc(doc(db, 'designReviews', id));
      setReviews(prev => prev.filter(r => r.id !== id));
      logActivity({
        userId: uid, projectId,
        eventType: 'design_review_deleted',
        tool: 'design_review',
        title: 'Design review deleted',
        timestampMs: Date.now(),
      });
    } catch (e) {
      console.warn('[ReviewStudio] delete error', e);
    }
  }

  function handleSaved(r: DesignReview) {
    setReviews(prev => {
      const idx = prev.findIndex(x => x.id === r.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = r;
        return copy;
      }
      return [r, ...prev];
    });
    setView('list');
    setEditingReview(null);
  }

  // Summary stats
  const totalReviews  = reviews.length;
  const openActions   = reviews.flatMap(r => r.actionItems).filter(a => !a.done).length;
  const mustPending   = reviews.flatMap(r => r.actionItems).filter(a => a.priority === 'must' && !a.done).length;
  const failItems     = reviews.flatMap(r => r.reviewItems).filter(i => i.status === 'fail').length;

  return (
    <div className="bg-slate-900 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Presentation size={16} className="text-sky-400" />
            <div>
              <h3 className="text-[13px] font-black uppercase tracking-widest text-white">Review Studio</h3>
              <p className="text-[9px] font-semibold text-slate-500 uppercase tracking-[0.2em] mt-0.5">
                Tool · Design reviews & gate package generator
              </p>
            </div>
          </div>
          {!readOnly && activeTab === 'reviews' && view === 'list' && (
            <button
              onClick={() => { setEditingReview(null); setView('form'); }}
              className="bg-sky-600 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded flex items-center gap-1.5 hover:bg-sky-500 transition-colors"
            >
              <Plus size={12} /> New Review
            </button>
          )}
        </div>

        {/* Tab strip */}
        <div className="flex gap-1 mt-4">
          {(['reviews', 'package'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setView('list'); }}
              className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded transition-colors ${
                activeTab === tab
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab === 'reviews' ? `Design Reviews${totalReviews > 0 ? ` (${totalReviews})` : ''}` : '📦 Generate Package'}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="bg-slate-50 p-6 min-h-[400px]">
        {activeTab === 'reviews' ? (
          <>
            {view === 'form' ? (
              <ReviewForm
                initial={editingReview ?? {}}
                projectId={projectId}
                onSave={handleSaved}
                onCancel={() => { setView('list'); setEditingReview(null); }}
                readOnly={readOnly}
              />
            ) : (
              <>
                {/* Summary strip */}
                {totalReviews > 0 && (
                  <div className="flex flex-wrap gap-4 mb-5 pb-5 border-b border-slate-200">
                    <div className="text-center">
                      <p className="text-[20px] font-black text-slate-800">{totalReviews}</p>
                      <p className="text-[9px] text-slate-400 uppercase tracking-widest">Reviews</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-[20px] font-black ${failItems > 0 ? 'text-rose-600' : 'text-slate-800'}`}>{failItems}</p>
                      <p className="text-[9px] text-slate-400 uppercase tracking-widest">Fail Items</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-[20px] font-black ${mustPending > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{mustPending}</p>
                      <p className="text-[9px] text-slate-400 uppercase tracking-widest">MUST Pending</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[20px] font-black text-slate-800">{openActions}</p>
                      <p className="text-[9px] text-slate-400 uppercase tracking-widest">Open Actions</p>
                    </div>
                  </div>
                )}

                {loading ? (
                  <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-[12px]">Loading reviews…</span>
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="text-center py-16">
                    <Presentation size={32} className="text-slate-200 mx-auto mb-3" />
                    <p className="text-[13px] font-semibold text-slate-400 mb-1">No design reviews yet</p>
                    <p className="text-[11px] text-slate-300">Log your first review — DR, TRR, CDR, PRR or any design checkpoint</p>
                    {!readOnly && (
                      <button
                        onClick={() => setView('form')}
                        className="mt-4 bg-sky-600 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded hover:bg-sky-700 transition-colors"
                      >
                        <Plus size={11} className="inline mr-1" /> New Review
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reviews.map(r => (
                      <ReviewCard
                        key={r.id}
                        review={r}
                        onOpen={() => { setEditingReview(r); setView('form'); }}
                        onDelete={() => handleDelete(r.id)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <PackageGenerator
            project={project}
            projectId={projectId}
            projectName={projectName}
            currentGate={currentGate}
            groupScores={groupScores}
            overall={overall}
          />
        )}
      </div>
    </div>
  );
}
