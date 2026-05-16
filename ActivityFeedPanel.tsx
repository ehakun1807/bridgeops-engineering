// ---------------------------------------------------------------------------
// ActivityFeedPanel — chronological project activity feed.
//
// Reads from the `projectActivity` Firestore collection (userId + projectId
// scoped, ordered by timestampMs desc). Renders a color-coded event stream
// across all tools with optional per-tool filtering.
//
// Pinned as a utility tab in ProjectDeepDive's secondary strip (alongside
// AI Analysis and History) — NOT behind the Project Tools launcher.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  Timer,
  CalendarIcon,
  ShieldAlert,
  Workflow,
  Boxes,
  Scale,
  FileText,
  Sparkles,
  ChevronDown,
  Loader2,
  Inbox,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { db, auth } from './firebase.ts';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot
} from 'firebase/firestore';
import type { ActivityEvent, ActivityEventType, ActivityTool } from './activityLogger.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const FEED_PAGE_SIZE = 30;
const FEED_MAX_ITEMS = 150;

// ---------------------------------------------------------------------------
// Tool metadata — color + icon per tool
// ---------------------------------------------------------------------------
const TOOL_META: Record<ActivityTool, {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  dotClass: string;      // bg-* for the timeline dot
  textClass: string;     // text-* for the icon
  bgClass: string;       // bg-* for the icon plate
  borderClass: string;   // border-* for the icon plate
}> = {
  takt:         { label: 'Studies',       icon: Timer,       dotClass: 'bg-emerald-400', textClass: 'text-emerald-700', bgClass: 'bg-emerald-50',  borderClass: 'border-emerald-200' },
  meetings:     { label: 'Meetings',      icon: CalendarIcon,dotClass: 'bg-violet-400',  textClass: 'text-violet-700',  bgClass: 'bg-violet-50',   borderClass: 'border-violet-200'  },
  pfmea:        { label: 'PFMEA',         icon: ShieldAlert, dotClass: 'bg-rose-400',    textClass: 'text-rose-700',    bgClass: 'bg-rose-50',     borderClass: 'border-rose-200'    },
  process_map:  { label: 'Process Map',   icon: Workflow,    dotClass: 'bg-blue-400',    textClass: 'text-blue-700',    bgClass: 'bg-blue-50',     borderClass: 'border-blue-200'    },
  bom_pulse:    { label: 'BOM Pulse',     icon: Boxes,       dotClass: 'bg-amber-400',   textClass: 'text-amber-700',   bgClass: 'bg-amber-50',    borderClass: 'border-amber-200'   },
  decisions:    { label: 'Decisions',     icon: Scale,       dotClass: 'bg-indigo-400',  textClass: 'text-indigo-700',  bgClass: 'bg-indigo-50',   borderClass: 'border-indigo-200'  },
  doc_guard:    { label: 'Doc Guard',     icon: FileText,    dotClass: 'bg-teal-400',    textClass: 'text-teal-700',    bgClass: 'bg-teal-50',     borderClass: 'border-teal-200'    },
  ai_analysis:  { label: 'AI Analysis',   icon: Sparkles,    dotClass: 'bg-blue-500',    textClass: 'text-blue-700',    bgClass: 'bg-blue-50',     borderClass: 'border-blue-200'    },
};

// Events that warrant a subtle highlight (high-signal moments)
const HIGH_SIGNAL_EVENTS = new Set<ActivityEventType>([
  'takt_study_completed',
  'pfmea_risk_high',
  'bom_impact_analyzed',
  'decision_reversed',
  'ai_analysis_run',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function relativeTime(ms: number): string {
  const diffMs = Date.now() - ms;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60)  return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)  return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)   return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7)   return `${diffDay}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatAbsoluteTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// Group events by calendar day for the date-divider rows
function groupByDay(events: ActivityEvent[]): Array<{ label: string; events: ActivityEvent[] }> {
  const groups: Map<string, ActivityEvent[]> = new Map();
  for (const e of events) {
    const d = new Date(e.timestampMs);
    const key = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return Array.from(groups.entries()).map(([label, events]) => ({ label, events }));
}

// ---------------------------------------------------------------------------
// FeedRow
// ---------------------------------------------------------------------------
function FeedRow({ event, isLast }: { event: ActivityEvent; isLast: boolean }) {
  const [hovered, setHovered] = useState(false);
  const meta = TOOL_META[event.tool];
  const Icon = meta.icon;
  const isHigh = HIGH_SIGNAL_EVENTS.has(event.eventType);

  return (
    <div
      className={`relative flex gap-3 pl-2 pr-3 py-2.5 rounded transition-colors ${
        hovered ? 'bg-slate-50' : ''
      } ${isHigh ? 'border-l-2 border-l-amber-300 ml-[-2px] pl-[10px]' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={formatAbsoluteTime(event.timestampMs)}
    >
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-[18px] top-[36px] bottom-0 w-px bg-slate-100" />
      )}

      {/* Tool icon plate */}
      <div className={`flex-none w-7 h-7 rounded border flex items-center justify-center mt-0.5 ${meta.bgClass} ${meta.borderClass}`}>
        <Icon size={13} className={meta.textClass} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-[12px] leading-snug ${isHigh ? 'font-semibold text-slate-800' : 'font-medium text-slate-700'}`}>
            {event.title}
          </p>
          <span className="flex-none text-[10px] text-slate-400 mt-0.5 whitespace-nowrap">
            {relativeTime(event.timestampMs)}
          </span>
        </div>
        {event.detail && (
          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed truncate">
            {event.detail}
          </p>
        )}
        <p className="text-[10px] text-slate-300 mt-0.5 uppercase tracking-wider">
          {meta.label}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActivityFeedPanel
// ---------------------------------------------------------------------------
interface Props {
  projectId: string;
}

type FilterTool = ActivityTool | 'all';

const FILTER_OPTIONS: Array<{ value: FilterTool; label: string }> = [
  { value: 'all',         label: 'All tools' },
  { value: 'takt',        label: 'Studies' },
  { value: 'meetings',    label: 'Meetings' },
  { value: 'pfmea',       label: 'PFMEA' },
  { value: 'process_map', label: 'Process Map' },
  { value: 'bom_pulse',   label: 'BOM Pulse' },
  { value: 'decisions',   label: 'Decisions' },
  { value: 'doc_guard',   label: 'Doc Guard' },
  { value: 'ai_analysis', label: 'AI Analysis' },
];

export default function ActivityFeedPanel({ projectId }: Props) {
  const uid = auth.currentUser?.uid ?? '';
  const [events, setEvents]       = useState<ActivityEvent[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [filter, setFilter]       = useState<FilterTool>('all');
  const [loadedCount, setLoadedCount] = useState(FEED_PAGE_SIZE);
  const unsubRef = useRef<(() => void) | null>(null);

  // Real-time listener — re-subscribes when projectId changes
  useEffect(() => {
    if (!uid || !projectId) { setLoading(false); return; }
    setLoading(true);
    setError(null);

    const q = query(
      collection(db, 'projectActivity'),
      where('userId', '==', uid),
      where('projectId', '==', projectId),
      orderBy('timestampMs', 'desc'),
      limit(FEED_MAX_ITEMS)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as ActivityEvent);
        setEvents(docs);
        setLoading(false);
      },
      (err) => {
        console.error('[ActivityFeedPanel]', err);
        setError('Could not load activity. Check Firestore index.');
        setLoading(false);
      }
    );

    unsubRef.current = unsub;
    return () => unsub();
  }, [uid, projectId]);

  const filtered = filter === 'all' ? events : events.filter((e) => e.tool === filter);
  const visible  = filtered.slice(0, loadedCount);
  const groups   = groupByDay(visible);
  const hasMore  = filtered.length > loadedCount;

  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-xl overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-slate-400" />
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">
              Project Intelligence · Layer 1
            </p>
            <h3 className="text-sm font-black uppercase tracking-tight">
              Activity Feed
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Tool filter */}
          <div className="relative">
            <select
              value={filter}
              onChange={(e) => { setFilter(e.target.value as FilterTool); setLoadedCount(FEED_PAGE_SIZE); }}
              className="appearance-none text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700 rounded px-2.5 py-1 pr-6 focus:outline-none focus:border-slate-500 cursor-pointer"
            >
              {FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown size={10} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
          {/* Count badge */}
          {!loading && (
            <span className="text-[10px] font-bold text-slate-400 tabular-nums">
              {filtered.length} event{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="min-h-[200px]">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-[12px]">Loading activity…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 px-6 text-center">
            <AlertTriangle size={20} className="text-amber-400" />
            <p className="text-[12px] text-slate-500">{error}</p>
            <p className="text-[11px] text-slate-400">
              Enable the composite index in Firebase Console → Firestore → Indexes.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
            <Inbox size={28} className="text-slate-200" />
            <div>
              <p className="text-[13px] font-semibold text-slate-400">No activity yet</p>
              <p className="text-[11px] text-slate-300 mt-1">
                {filter === 'all'
                  ? 'Events appear here as you use the project tools — studies, meetings, PFMEA, BOM uploads, decisions and more.'
                  : `No ${FILTER_OPTIONS.find(o => o.value === filter)?.label} events yet.`}
              </p>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3">
            <AnimatePresence mode="popLayout">
              {groups.map((group) => (
                <div key={group.label} className="mb-4">
                  {/* Day divider */}
                  <div className="flex items-center gap-2 mb-2 px-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                      {group.label}
                    </span>
                    <div className="flex-1 h-px bg-slate-100" />
                  </div>
                  {/* Events */}
                  {group.events.map((event, idx) => (
                    <motion.div
                      key={`${event.timestampMs}-${event.eventType}`}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      <FeedRow
                        event={event}
                        isLast={idx === group.events.length - 1}
                      />
                    </motion.div>
                  ))}
                </div>
              ))}
            </AnimatePresence>

            {/* Load more */}
            {hasMore && (
              <button
                type="button"
                onClick={() => setLoadedCount((c) => c + FEED_PAGE_SIZE)}
                className="w-full mt-2 py-2 text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition-colors flex items-center justify-center gap-1.5"
              >
                <RefreshCw size={11} />
                Load more ({filtered.length - loadedCount} remaining)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
