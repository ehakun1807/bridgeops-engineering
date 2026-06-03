// ---------------------------------------------------------------------------
// MeetingsTool — Per-project meetings log. Lives next to Studies in the
// ProjectDeepDive utility tab strip.
//
// Purpose: capture internal/external meetings tied to a project so the
// engineering record (notes + action items) lives alongside the rest of
// the project surface, not in a separate doc folder.
//
// Lifecycle: always editable. Open a meeting any time, edit, save. No
// draft/completed split — that ceremony fits time-studies (lock the
// validated verdict) but not meeting notes (always evolving).
//
// Persistence: `meetings` Firestore collection, one doc per meeting.
// userId + projectId scoped, mirrors the taktStudies rules pattern.
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
  Building2,
  ExternalLink as ExternalLinkIcon,
  Download
} from 'lucide-react';
import { downloadMeetingsPdf } from './utils/meetingsPdf.ts';
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

export type MeetingKind = 'internal' | 'external';

export interface Meeting {
  id: string;                // Firestore doc id ('' for unsaved)
  userId: string;
  projectId: string;
  dateMs: number;            // meeting date as epoch ms (UTC midnight of the chosen day)
  title: string;             // scope / title
  attendees: string;         // free-text, comma-separated names
  kind: MeetingKind;
  notes: string;             // general discussion notes
  actionItems: string;       // action items
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

const TITLE_MAX = 200;
const ATTENDEES_MAX = 500;
const NOTES_MAX = 1000;
const ACTIONS_MAX = 1000;

// ---------------------------------------------------------------------------
// Date helpers — meetings store a calendar date (no time-of-day) as an epoch
// ms. We anchor to UTC midnight so the same value renders consistently
// regardless of the user's local TZ. yyyy-mm-dd <input type="date"> is the
// canonical UI form.
// ---------------------------------------------------------------------------

function todayDateInputValue(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dateInputValueFromMs(ms: number): string {
  if (!ms || !isFinite(ms)) return todayDateInputValue();
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function msFromDateInputValue(v: string): number {
  // v is yyyy-mm-dd. Anchor to UTC midnight.
  if (!v) return Date.now();
  const [y, m, d] = v.split('-').map((p) => Number(p));
  if (!y || !m || !d) return Date.now();
  return Date.UTC(y, m - 1, d);
}

function formatMeetingDate(ms: number): string {
  if (!ms || !isFinite(ms)) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

const newMeeting = (projectId: string, userId: string): Meeting => ({
  id: '',
  userId,
  projectId,
  dateMs: msFromDateInputValue(todayDateInputValue()),
  title: '',
  attendees: '',
  kind: 'internal',
  notes: '',
  actionItems: ''
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MeetingsToolProps {
  projectId: string;
  projectName?: string;
  readOnly?: boolean;
}

type Mode = { kind: 'list' } | { kind: 'edit'; meeting: Meeting };

const MeetingsTool: React.FC<MeetingsToolProps> = ({ projectId, projectName = '', readOnly = false }) => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  const uid = auth.currentUser?.uid ?? '';

  const loadMeetings = async () => {
    if (!uid || !projectId) {
      setMeetings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = query(
        collection(db, 'meetings'),
        where('userId', '==', uid),
        where('projectId', '==', projectId),
        orderBy('dateMs', 'desc')
      );
      const snap = await getDocs(q);
      const rows: Meeting[] = snap.docs.map((d) => {
        const data = d.data() as Omit<Meeting, 'id'>;
        return { ...data, id: d.id };
      });
      setMeetings(rows);
    } catch (e: any) {
      console.error('[MeetingsTool] load failed', e);
      setError(e?.message || 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMeetings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, projectId]);

  const startNew = () => {
    if (!uid) return;
    setMode({ kind: 'edit', meeting: newMeeting(projectId, uid) });
  };

  const openMeeting = (m: Meeting) => setMode({ kind: 'edit', meeting: m });

  const cancelEdit = () => setMode({ kind: 'list' });

  const saveMeeting = async (m: Meeting) => {
    if (!uid) throw new Error('Not authenticated');
    const payload = {
      userId: uid,
      projectId,
      dateMs: Number(m.dateMs) || msFromDateInputValue(todayDateInputValue()),
      title: m.title.slice(0, TITLE_MAX).trim() || 'Untitled meeting',
      attendees: m.attendees.slice(0, ATTENDEES_MAX),
      kind: m.kind === 'external' ? 'external' : 'internal',
      notes: m.notes.slice(0, NOTES_MAX),
      actionItems: m.actionItems.slice(0, ACTIONS_MAX),
      updatedAt: serverTimestamp()
    };
    if (m.id) {
      await updateDoc(doc(db, 'meetings', m.id), payload);
    } else {
      await addDoc(collection(db, 'meetings'), {
        ...payload,
        createdAt: serverTimestamp()
      });
    }
    // Log activity (fire-and-forget)
    const isNew = !m.id;
    logActivity({
      userId: uid,
      projectId,
      eventType: isNew ? 'meeting_created' : 'meeting_updated',
      tool: 'meetings',
      title: isNew ? `Meeting logged: ${payload.title}` : `Meeting updated: ${payload.title}`,
      detail: payload.actionItems.trim()
        ? `Action items: ${payload.actionItems.slice(0, 120)}`
        : payload.attendees.trim() ? `Attendees: ${payload.attendees.slice(0, 80)}` : undefined,
      metadata: { kind: payload.kind },
      timestampMs: Date.now(),
    });

    await loadMeetings();
    setMode({ kind: 'list' });
  };

  const deleteMeeting = async (m: Meeting) => {
    if (!m.id) return;
    if (!confirm(`Delete "${m.title || 'this meeting'}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'meetings', m.id));
      logActivity({
        userId: uid,
        projectId,
        eventType: 'meeting_deleted',
        tool: 'meetings',
        title: `Meeting deleted: ${m.title || 'Untitled'}`,
        timestampMs: Date.now(),
      });
      await loadMeetings();
    } catch (e: any) {
      console.error('[MeetingsTool] delete failed', e);
      alert(e?.message || 'Delete failed');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-xl overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarIcon size={20} className="text-slate-300" />
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/70 mb-1">
              Tool
            </p>
            <h3 className="text-lg font-black uppercase tracking-tight leading-tight">
              Meetings
            </h3>
          </div>
        </div>
        {mode.kind === 'list' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadMeetings}
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
                <Plus size={12} /> New Meeting
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
            <MeetingList
              meetings={meetings}
              loading={loading}
              error={error}
              onOpen={openMeeting}
              onDelete={deleteMeeting}
              onDownload={async (m) => {
                await downloadMeetingsPdf([{
                  id: m.id, dateMs: m.dateMs, title: m.title,
                  attendees: m.attendees, kind: m.kind,
                  notes: m.notes, actionItems: m.actionItems
                }], projectName);
              }}
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
            <MeetingForm
              initial={mode.meeting}
              onCancel={cancelEdit}
              onSave={saveMeeting}
              readOnly={readOnly}
              projectName={projectName}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MeetingsTool;

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

interface MeetingListProps {
  meetings: Meeting[];
  loading: boolean;
  error: string | null;
  onOpen: (m: Meeting) => void;
  onDelete: (m: Meeting) => void;
  onDownload: (m: Meeting) => void;
  readOnly: boolean;
}

const MeetingList: React.FC<MeetingListProps> = ({
  meetings,
  loading,
  error,
  onOpen,
  onDelete,
  onDownload,
  readOnly
}) => {
  if (loading) {
    return (
      <div className="px-6 py-10 flex items-center justify-center text-slate-400 text-sm gap-2">
        <Loader2 size={14} className="animate-spin" /> Loading meetings…
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
  if (meetings.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <CalendarIcon size={28} className="mx-auto text-slate-300 mb-3" />
        <p className="text-sm text-slate-500 mb-1">No meetings logged yet.</p>
        <p className="text-[11px] text-slate-400">
          Click <span className="font-semibold text-slate-600">New Meeting</span> to record the first one.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {meetings.map((m) => {
        const KindIcon = m.kind === 'external' ? ExternalLinkIcon : Building2;
        const kindLabel = m.kind === 'external' ? 'External' : 'Internal';
        const kindClass =
          m.kind === 'external'
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-blue-50 text-blue-700 border-blue-200';
        const hasActions = m.actionItems && m.actionItems.trim().length > 0;
        return (
          <li key={m.id} className="px-6 py-4 flex items-start gap-4 hover:bg-slate-50 transition-colors">
            <button
              type="button"
              onClick={() => onOpen(m)}
              className="flex-1 text-left"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500 tabular-nums">
                  {formatMeetingDate(m.dateMs)}
                </span>
                <span
                  className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${kindClass}`}
                >
                  <KindIcon size={10} /> {kindLabel}
                </span>
                {hasActions && (
                  <span className="inline-flex items-center border border-emerald-200 bg-emerald-50 text-emerald-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">
                    Action items
                  </span>
                )}
              </div>
              <p className="text-sm font-bold text-slate-900 mt-1 truncate">
                {m.title || 'Untitled meeting'}
              </p>
              {m.attendees && (
                <p className="text-[11px] text-slate-500 mt-0.5 flex items-start gap-1">
                  <Users size={11} className="mt-0.5 flex-shrink-0" />
                  <span className="line-clamp-1">{m.attendees}</span>
                </p>
              )}
            </button>
            <button
              type="button"
              onClick={() => onDownload(m)}
              title="Download as PDF"
              className="text-slate-400 hover:text-slate-700 transition-colors p-1"
            >
              <Download size={14} />
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onDelete(m)}
                title="Delete meeting"
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
// Form view
// ---------------------------------------------------------------------------

interface MeetingFormProps {
  initial: Meeting;
  onCancel: () => void;
  onSave: (m: Meeting) => Promise<void>;
  readOnly: boolean;
  projectName?: string;
}

const MeetingForm: React.FC<MeetingFormProps> = ({ initial, onCancel, onSave, readOnly, projectName = '' }) => {
  const [draft, setDraft] = useState<Meeting>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

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
      console.error('[MeetingsTool] save failed', e);
      setSaveError(e?.message || 'Save failed');
      setSaving(false);
    }
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
          {isNew ? 'New meeting' : 'Edit meeting'}
        </span>
      </div>

      {/* Date + Type */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Date
          </label>
          <input
            type="date"
            value={dateInputValueFromMs(draft.dateMs)}
            onChange={(e) =>
              setDraft({ ...draft, dateMs: msFromDateInputValue(e.target.value) })
            }
            disabled={readOnly}
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Type
          </label>
          <select
            value={draft.kind}
            onChange={(e) =>
              setDraft({ ...draft, kind: e.target.value === 'external' ? 'external' : 'internal' })
            }
            disabled={readOnly}
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50 bg-white"
          >
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </select>
        </div>
        <div className="md:col-span-1">
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            &nbsp;
          </label>
          <div className="text-[11px] text-slate-400 pt-2">
            {draft.kind === 'external'
              ? 'Vendors, customers, partners, auditors.'
              : 'Internal team / cross-functional sync.'}
          </div>
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
          Scope / Title
        </label>
        <input
          type="text"
          value={draft.title}
          maxLength={TITLE_MAX}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          disabled={readOnly}
          placeholder="e.g. PDR review with mech team"
          className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50"
        />
        <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
          {draft.title.length} / {TITLE_MAX}
        </div>
      </div>

      {/* Attendees */}
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
          Attendees
        </label>
        <textarea
          value={draft.attendees}
          maxLength={ATTENDEES_MAX}
          onChange={(e) => setDraft({ ...draft, attendees: e.target.value })}
          disabled={readOnly}
          rows={2}
          placeholder="Comma-separated names (e.g. A. Singh, J. Park, vendor rep)"
          className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50 resize-y"
        />
        <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
          {draft.attendees.length} / {ATTENDEES_MAX}
        </div>
      </div>

      {/* Two split textareas: Notes + Action items */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Discussion Notes
          </label>
          <textarea
            value={draft.notes}
            maxLength={NOTES_MAX}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            disabled={readOnly}
            rows={10}
            placeholder="Topics discussed, decisions, open questions…"
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50 resize-y leading-relaxed"
          />
          <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
            {draft.notes.length} / {NOTES_MAX}
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Action Items
          </label>
          <textarea
            value={draft.actionItems}
            maxLength={ACTIONS_MAX}
            onChange={(e) => setDraft({ ...draft, actionItems: e.target.value })}
            disabled={readOnly}
            rows={10}
            placeholder="Owner — task — due date. One per line."
            className="w-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50 resize-y leading-relaxed"
          />
          <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
            {draft.actionItems.length} / {ACTIONS_MAX}
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
        <div>
          {!isNew && (
            <button
              type="button"
              disabled={downloading}
              onClick={async () => {
                setDownloading(true);
                try {
                  await downloadMeetingsPdf([{
                    id: draft.id, dateMs: draft.dateMs, title: draft.title,
                    attendees: draft.attendees, kind: draft.kind,
                    notes: draft.notes, actionItems: draft.actionItems
                  }], projectName);
                } finally {
                  setDownloading(false);
                }
              }}
              title="Download this meeting as PDF"
              className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              Download PDF
            </button>
          )}
        </div>
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
            {saving ? 'Saving…' : isNew ? 'Save Meeting' : 'Save Changes'}
          </button>
        )}
        </div>
      </div>
    </div>
  );
};
