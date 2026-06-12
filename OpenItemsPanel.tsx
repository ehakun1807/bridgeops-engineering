// ---------------------------------------------------------------------------
// OpenItemsPanel.tsx — Unified open-items view (pinned tab in ProjectDeepDive)
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, Circle, Plus, Loader2, AlertTriangle,
  MessageSquare, Lightbulb, ShieldAlert, ClipboardCheck,
  Scale, SlidersHorizontal, ChevronDown, X, EyeOff,
  RefreshCw, User, Send,
} from 'lucide-react';
import {
  Firestore, collection, query, where, getDocs,
  doc, updateDoc, addDoc, deleteDoc, setDoc, getDoc,
} from 'firebase/firestore';
import { RAMP_GROUPS, DeliverableTemplate, ProductGate } from './rampGroups.ts';
import { SubItemDeliverables } from './ProjectDeepDive.tsx';
import { logActivity } from './activityLogger.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type OpenItemPriority = 'high' | 'medium' | 'low';
export type OpenItemSource =
  | 'meeting' | 'lesson' | 'pfmea' | 'deliverable' | 'decision' | 'custom';

export interface UnifiedOpenItem {
  uid: string;
  source: OpenItemSource;
  sourceDocId: string;
  sourceIdx?: number;
  title: string;
  subtitle?: string;
  priority: OpenItemPriority;
  closeable: boolean;
  closed: boolean;
}

interface CustomOpenItemDoc {
  userId: string;
  projectId: string;
  title: string;
  description?: string;
  assignee?: string;
  priority: OpenItemPriority;
  status: 'open' | 'closed';
  createdAtMs: number;
  updatedAtMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SOURCE_META: Record<OpenItemSource, {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  chipClass: string;
}> = {
  meeting:     { label: 'Meeting',  icon: MessageSquare,     chipClass: 'bg-violet-50 text-violet-700 border-violet-200' },
  lesson:      { label: 'Lesson',   icon: Lightbulb,         chipClass: 'bg-teal-50 text-teal-700 border-teal-200' },
  pfmea:       { label: 'PFMEA',    icon: ShieldAlert,       chipClass: 'bg-rose-50 text-rose-700 border-rose-200' },
  deliverable: { label: '',         icon: ClipboardCheck,    chipClass: '' }, // chip hidden
  decision:    { label: 'Decision', icon: Scale,             chipClass: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  custom:      { label: 'Custom',   icon: SlidersHorizontal, chipClass: 'bg-slate-100 text-slate-600 border-slate-300' },
};

const PRIORITY_META: Record<OpenItemPriority, { label: string; dotClass: string }> = {
  high:   { label: 'High',   dotClass: 'bg-rose-500' },
  medium: { label: 'Medium', dotClass: 'bg-amber-400' },
  low:    { label: 'Low',    dotClass: 'bg-slate-400' },
};

const PRIORITY_ORDER: Record<OpenItemPriority, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_CYCLE: Record<OpenItemPriority, OpenItemPriority> = {
  high: 'medium', medium: 'low', low: 'high',
};

const metaDocId = (userId: string, projectId: string) =>
  `${userId}_${projectId}`.replace(/[^a-zA-Z0-9_-]/g, '_');

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface OpenItemsPanelProps {
  projectId: string;
  userId: string;
  db: Firestore;
  currentGate?: ProductGate;
  deliverables: Record<string, SubItemDeliverables>;
  onCloseDeliverable: (itemId: string, deliverableId: string) => Promise<void>;
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const parseMeetingActions = (raw: string): string[] =>
  raw
    .split('\n')
    .map((l) => l.replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, '').trim())
    .filter((l) => l.length > 0);

const blankCustom = () => ({
  title: '', description: '', assignee: '', priority: 'medium' as OpenItemPriority,
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const OpenItemsPanel: React.FC<OpenItemsPanelProps> = ({
  projectId, userId, db, currentGate, deliverables, onCloseDeliverable, readOnly = false,
}) => {
  // ── data state ──────────────────────────────────────────────────────────
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [closingUid, setClosingUid] = useState<string | null>(null);
  const [dismissingUid, setDismissingUid] = useState<string | null>(null);

  const [meetingDocs, setMeetingDocs]   = useState<Array<{ id: string; title: string; actionItems: string }>>([]);
  const [lessonDocs, setLessonDocs]     = useState<Array<{ id: string; title: string; actionItems: Array<{ id: string; text: string; priority: string; done: boolean }> }>>([]);
  const [pfmeaDocs, setPfmeaDocs]       = useState<Array<{ id: string; title: string; risks: Array<{ id: string; processStep: string; failureMode: string; rpn: number; actionsTaken: string }> }>>([]);
  const [decisionDocs, setDecisionDocs] = useState<Array<{ id: string; title: string; rationale: string }>>([]);
  const [customDocs, setCustomDocs]     = useState<Array<{ id: string } & CustomOpenItemDoc>>([]);

  // persisted overrides
  const [dismissedUids,    setDismissedUids]    = useState<Set<string>>(new Set());
  const [priorityOverrides, setPriorityOverrides] = useState<Record<string, OpenItemPriority>>({});
  const [ownerOverrides,    setOwnerOverrides]    = useState<Record<string, string>>({});

  // display order — set once on initial load (priority-sorted), then preserved
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);
  const isFirstLoad = useRef(true);

  // owner editing
  const [ownerDrafts, setOwnerDrafts]   = useState<Record<string, string>>({});
  const ownerSaveTimers                 = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // PFMEA inline resolve form: uid of the item being resolved + action text
  const [pendingResolveUid,  setPendingResolveUid]  = useState<string | null>(null);
  const [pendingResolveText, setPendingResolveText] = useState('');

  // ── UI state ────────────────────────────────────────────────────────────
  const [filterSource,   setFilterSource]   = useState<OpenItemSource | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<OpenItemPriority | 'all'>('all');
  const [showClosed,     setShowClosed]     = useState(false);
  const [addingCustom,   setAddingCustom]   = useState(false);
  const [customDraft,    setCustomDraft]    = useState(blankCustom());
  const [savingCustom,   setSavingCustom]   = useState(false);

  // ── load ────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [meetingsSnap, lessonsSnap, pfmeasSnap, decisionsSnap, customSnap, metaSnap] =
        await Promise.all([
          getDocs(query(collection(db, 'meetings'),  where('userId', '==', userId), where('projectId', '==', projectId))),
          getDocs(query(collection(db, 'lessons'),   where('userId', '==', userId), where('projectId', '==', projectId))),
          getDocs(query(collection(db, 'pfmeas'),    where('userId', '==', userId), where('projectId', '==', projectId))),
          getDocs(query(collection(db, 'decisions'), where('userId', '==', userId), where('projectId', '==', projectId))),
          getDocs(query(collection(db, 'openItems'), where('userId', '==', userId), where('projectId', '==', projectId))),
          getDoc(doc(db, 'openItemsDismissed', metaDocId(userId, projectId))),
        ]);

      setMeetingDocs(meetingsSnap.docs.map((d) => {
        const data = d.data() as any;
        return { id: d.id, title: data.scope || data.title || 'Meeting', actionItems: data.actionItems || '' };
      }));
      setLessonDocs(lessonsSnap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id, title: data.title || 'Lesson',
          actionItems: (data.actionItems || []).map((a: any) => ({
            id: a.id, text: a.text, priority: a.priority, done: !!a.done,
          })),
        };
      }));
      setPfmeaDocs(pfmeasSnap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id, title: data.title || 'PFMEA',
          risks: (data.risks || []).map((r: any) => ({
            id: r.id, processStep: r.processStep || '', failureMode: r.failureMode || '',
            rpn: (r.severity || 1) * (r.occurrence || 1) * (r.detection || 1),
            actionsTaken: r.actionsTaken || '',
          })),
        };
      }));
      setDecisionDocs(decisionsSnap.docs
        .filter((d) => (d.data() as any).status === 'reversed')
        .map((d) => {
          const data = d.data() as any;
          return { id: d.id, title: data.title || 'Decision', rationale: data.rationale || '' };
        })
      );
      setCustomDocs(customSnap.docs.map((d) => ({ id: d.id, ...(d.data() as CustomOpenItemDoc) })));

      if (metaSnap.exists()) {
        const d = metaSnap.data() as any;
        setDismissedUids(new Set((d.dismissedUids || []) as string[]));
        setPriorityOverrides((d.priorityOverrides || {}) as Record<string, OpenItemPriority>);
        setOwnerOverrides((d.ownerOverrides || {}) as Record<string, string>);
      }
    } catch (e) {
      console.warn('[OpenItemsPanel] load error', e);
    } finally {
      if (isRefresh) setRefreshing(false); else setLoading(false);
    }
  }, [db, userId, projectId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── persist metadata ─────────────────────────────────────────────────────
  const persistMetadata = useCallback(async (
    uids: Set<string>,
    pOverrides: Record<string, OpenItemPriority>,
    oOverrides: Record<string, string>
  ) => {
    try {
      await setDoc(
        doc(db, 'openItemsDismissed', metaDocId(userId, projectId)),
        { userId, projectId, dismissedUids: Array.from(uids), priorityOverrides: pOverrides, ownerOverrides: oOverrides },
        { merge: false }
      );
    } catch (e) {
      console.warn('[OpenItemsPanel] persist metadata error', e);
    }
  }, [db, userId, projectId]);

  // ── deliverable items (live from props) ──────────────────────────────────
  const deliverableItems = useMemo((): UnifiedOpenItem[] => {
    if (!currentGate) return [];
    const items: UnifiedOpenItem[] = [];
    for (const group of RAMP_GROUPS) {
      for (const rampItem of group.items) {
        const state      = deliverables[rampItem.id];
        const checkedIds = state?.checkedIds        ?? [];
        const waivedIds  = state?.waivedTemplateIds ?? [];
        const hiddenIds  = state?.hiddenTemplateIds ?? [];
        for (const td of (rampItem.deliverables ?? []) as DeliverableTemplate[]) {
          if (td.dueBy !== currentGate)   continue;
          if (checkedIds.includes(td.id)) continue;
          if (waivedIds.includes(td.id))  continue;
          if (hiddenIds.includes(td.id))  continue;
          items.push({
            uid: `deliverable-${rampItem.id}-${td.id}`, source: 'deliverable',
            sourceDocId: rampItem.id, title: td.title,
            subtitle: `${rampItem.title} · due ${currentGate}`,
            priority: 'medium', closeable: true, closed: false,
          });
        }
      }
    }
    return items;
  }, [deliverables, currentGate]);

  // ── build raw items (no sort — order managed by displayOrder) ─────────────
  const rawItems = useMemo((): UnifiedOpenItem[] => {
    const items: UnifiedOpenItem[] = [];

    for (const m of meetingDocs) {
      parseMeetingActions(m.actionItems).forEach((text, idx) => {
        items.push({
          uid: `meeting-${m.id}-${idx}`, source: 'meeting', sourceDocId: m.id, sourceIdx: idx,
          title: text, subtitle: m.title, priority: 'medium', closeable: true, closed: false,
        });
      });
    }

    for (const l of lessonDocs) {
      l.actionItems.filter((a) => a.priority === 'must').forEach((a, idx) => {
        items.push({
          uid: `lesson-${l.id}-${a.id}`, source: 'lesson', sourceDocId: l.id, sourceIdx: idx,
          title: a.text, subtitle: l.title, priority: 'high', closeable: true, closed: a.done,
        });
      });
    }

    for (const p of pfmeaDocs) {
      p.risks.filter((r) => r.rpn > 100 && !r.actionsTaken.trim()).forEach((r) => {
        items.push({
          uid: `pfmea-${p.id}-${r.id}`, source: 'pfmea', sourceDocId: p.id,
          title: r.failureMode || r.processStep || 'High-RPN risk',
          subtitle: `${p.title} · RPN ${r.rpn}`,
          priority: 'high', closeable: true, closed: false,
        });
      });
    }

    for (const d of decisionDocs) {
      items.push({
        uid: `decision-${d.id}`, source: 'decision', sourceDocId: d.id,
        title: d.title,
        subtitle: d.rationale ? d.rationale.slice(0, 80) : 'Reversed decision',
        priority: 'medium', closeable: true, closed: false,
      });
    }

    items.push(...deliverableItems);

    for (const c of customDocs) {
      items.push({
        uid: `custom-${c.id}`, source: 'custom', sourceDocId: c.id,
        title: c.title, subtitle: c.description?.slice(0, 80) || undefined,
        priority: c.priority, closeable: true, closed: c.status === 'closed',
      });
    }

    return items;
  }, [meetingDocs, lessonDocs, pfmeaDocs, decisionDocs, deliverableItems, customDocs]);

  // ── set display order once on initial load; preserve it on refresh ────────
  useEffect(() => {
    if (rawItems.length === 0) return;

    if (isFirstLoad.current) {
      // First load: sort by priority and lock the order
      isFirstLoad.current = false;
      const sorted = [...rawItems].sort((a, b) => {
        if (a.closed !== b.closed) return a.closed ? 1 : -1;
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      });
      setDisplayOrder(sorted.map((i) => i.uid));
    } else {
      // Subsequent loads (Refresh): keep existing positions, append brand-new items,
      // drop UIDs that no longer exist
      setDisplayOrder((prev) => {
        const currentSet = new Set(rawItems.map((i) => i.uid));
        const prevSet    = new Set(prev);
        const hasChange  = rawItems.some((i) => !prevSet.has(i.uid)) || prev.some((uid) => !currentSet.has(uid));
        if (!hasChange) return prev;
        const validPrev = prev.filter((uid) => currentSet.has(uid));
        const newUids   = rawItems.filter((i) => !prevSet.has(i.uid)).map((i) => i.uid);
        return [...validPrev, ...newUids];
      });
    }
  }, [rawItems]);

  // ── apply priority overrides (display only — never re-sorts) ─────────────
  const allItems = useMemo((): UnifiedOpenItem[] =>
    rawItems.map((item) =>
      priorityOverrides[item.uid] ? { ...item, priority: priorityOverrides[item.uid] } : item
    ),
    [rawItems, priorityOverrides]
  );

  const itemMap    = useMemo(() => new Map(allItems.map((i) => [i.uid, i])), [allItems]);
  const activeItems = allItems.filter((i) => !i.closed && !dismissedUids.has(i.uid));
  const openCount   = activeItems.length;
  const highCount   = activeItems.filter((i) => i.priority === 'high').length;

  // ── visible items — ordered by stable displayOrder, then filtered ─────────
  const visibleItems = useMemo(() => {
    const ordered = displayOrder
      .map((uid) => itemMap.get(uid))
      .filter((item): item is UnifiedOpenItem => !!item);

    return ordered.filter((item) => {
      if (dismissedUids.has(item.uid))                                 return false;
      if (!showClosed && item.closed)                                  return false;
      if (filterSource   !== 'all' && item.source   !== filterSource)  return false;
      if (filterPriority !== 'all' && item.priority !== filterPriority) return false;
      return true;
    });
  }, [displayOrder, itemMap, dismissedUids, showClosed, filterSource, filterPriority]);

  // ── dismiss ───────────────────────────────────────────────────────────────
  const handleDismiss = async (uid: string) => {
    if (readOnly) return;
    setDismissingUid(uid);
    const next = new Set(dismissedUids);
    next.add(uid);
    setDismissedUids(next);
    await persistMetadata(next, priorityOverrides, ownerOverrides);
    setDismissingUid(null);
  };

  // ── toggle priority ───────────────────────────────────────────────────────
  const handleTogglePriority = async (item: UnifiedOpenItem) => {
    if (readOnly || item.closed) return;
    const next: OpenItemPriority = PRIORITY_CYCLE[item.priority];

    if (item.source === 'custom') {
      try {
        await updateDoc(doc(db, 'openItems', item.sourceDocId), { priority: next, updatedAtMs: Date.now() });
        setCustomDocs((prev) => prev.map((c) => c.id === item.sourceDocId ? { ...c, priority: next } : c));
      } catch (e) { console.warn('[OpenItemsPanel] toggle priority error', e); }
    } else {
      const nextOverrides = { ...priorityOverrides, [item.uid]: next };
      setPriorityOverrides(nextOverrides);
      await persistMetadata(dismissedUids, nextOverrides, ownerOverrides);
    }
  };

  // ── owner (debounced, 800ms) ──────────────────────────────────────────────
  const handleOwnerChange = (uid: string, value: string) => {
    setOwnerDrafts((prev) => ({ ...prev, [uid]: value }));
    clearTimeout(ownerSaveTimers.current[uid]);
    ownerSaveTimers.current[uid] = setTimeout(async () => {
      const cDoc = customDocs.find((c) => `custom-${c.id}` === uid);
      if (cDoc) {
        try {
          await updateDoc(doc(db, 'openItems', cDoc.id), { assignee: value.trim(), updatedAtMs: Date.now() });
          setCustomDocs((prev) => prev.map((c) => c.id === cDoc.id ? { ...c, assignee: value.trim() } : c));
        } catch (e) { console.warn('[OpenItemsPanel] owner update error', e); }
      } else {
        const nextOwners = { ...ownerOverrides, [uid]: value.trim() };
        if (!value.trim()) delete nextOwners[uid];
        setOwnerOverrides(nextOwners);
        await persistMetadata(dismissedUids, priorityOverrides, nextOwners);
      }
    }, 800);
  };

  const getOwner = (item: UnifiedOpenItem): string => {
    if (item.uid in ownerDrafts) return ownerDrafts[item.uid];
    if (item.source === 'custom') return customDocs.find((c) => c.id === item.sourceDocId)?.assignee || '';
    return ownerOverrides[item.uid] || '';
  };

  // ── close ─────────────────────────────────────────────────────────────────
  const handleClose = async (item: UnifiedOpenItem, resolveText?: string) => {
    if (!item.closeable || item.closed || readOnly) return;

    // PFMEA: expand inline resolve form instead of immediately closing
    if (item.source === 'pfmea' && !resolveText) {
      setPendingResolveUid(item.uid);
      setPendingResolveText('');
      return;
    }

    setClosingUid(item.uid);
    try {
      if (item.source === 'meeting') {
        const mDoc = meetingDocs.find((m) => m.id === item.sourceDocId);
        if (mDoc) {
          const lines   = parseMeetingActions(mDoc.actionItems);
          lines.splice(item.sourceIdx ?? 0, 1);
          const newText = lines.join('\n');
          await updateDoc(doc(db, 'meetings', mDoc.id), { actionItems: newText });
          setMeetingDocs((prev) => prev.map((m) => m.id === mDoc.id ? { ...m, actionItems: newText } : m));
        }
      } else if (item.source === 'lesson') {
        const lDoc = lessonDocs.find((l) => l.id === item.sourceDocId);
        if (lDoc) {
          const actionId       = item.uid.slice(`lesson-${lDoc.id}-`.length);
          const updatedActions = lDoc.actionItems.map((a) => a.id === actionId ? { ...a, done: true } : a);
          await updateDoc(doc(db, 'lessons', lDoc.id), { actionItems: updatedActions });
          setLessonDocs((prev) => prev.map((l) => l.id === lDoc.id ? { ...l, actionItems: updatedActions } : l));
        }
      } else if (item.source === 'pfmea' && resolveText) {
        // Write actionsTaken back to the specific risk in the PFMEA doc
        const pDoc = pfmeaDocs.find((p) => p.id === item.sourceDocId);
        if (pDoc) {
          const riskId  = item.uid.slice(`pfmea-${pDoc.id}-`.length);
          const snap    = await getDoc(doc(db, 'pfmeas', pDoc.id));
          if (snap.exists()) {
            const data         = snap.data() as any;
            const updatedRisks = (data.risks as any[]).map((r) =>
              r.id === riskId ? { ...r, actionsTaken: resolveText.trim() } : r
            );
            await updateDoc(doc(db, 'pfmeas', pDoc.id), { risks: updatedRisks, updatedAt: Date.now() });
            setPfmeaDocs((prev) => prev.map((p2) =>
              p2.id === pDoc.id
                ? { ...p2, risks: p2.risks.map((r) => r.id === riskId ? { ...r, actionsTaken: resolveText.trim() } : r) }
                : p2
            ));
          }
        }
        setPendingResolveUid(null);
        setPendingResolveText('');
      } else if (item.source === 'decision') {
        // Reinstate reversed decision → active so it leaves the reversed-filter
        await updateDoc(doc(db, 'decisions', item.sourceDocId), { status: 'active', updatedAtMs: Date.now() });
        setDecisionDocs((prev) => prev.filter((d) => d.id !== item.sourceDocId));
      } else if (item.source === 'deliverable') {
        const tdId = item.uid.slice(`deliverable-${item.sourceDocId}-`.length);
        await onCloseDeliverable(item.sourceDocId, tdId);
      } else if (item.source === 'custom') {
        await updateDoc(doc(db, 'openItems', item.sourceDocId), { status: 'closed', updatedAtMs: Date.now() });
        setCustomDocs((prev) => prev.map((c) => c.id === item.sourceDocId ? { ...c, status: 'closed' } : c));
        logActivity({ userId, projectId, eventType: 'open_item_closed', tool: 'open_items', title: `Closed: ${item.title.slice(0, 60)}`, timestampMs: Date.now() });
      }
    } catch (e) { console.warn('[OpenItemsPanel] close error', e); }
    finally { setClosingUid(null); }
  };

  // ── add/delete custom ─────────────────────────────────────────────────────
  const handleSaveCustom = async () => {
    if (!customDraft.title.trim()) return;
    setSavingCustom(true);
    try {
      const payload: CustomOpenItemDoc = {
        userId, projectId,
        title:       customDraft.title.trim(),
        description: customDraft.description.trim() || undefined,
        assignee:    customDraft.assignee.trim()    || undefined,
        priority:    customDraft.priority,
        status:      'open',
        createdAtMs: Date.now(), updatedAtMs: Date.now(),
      };
      const ref = await addDoc(collection(db, 'openItems'), payload);
      setCustomDocs((prev) => [...prev, { id: ref.id, ...payload }]);
      logActivity({ userId, projectId, eventType: 'open_item_created', tool: 'open_items', title: `Added: ${payload.title.slice(0, 60)}`, timestampMs: Date.now() });
      setCustomDraft(blankCustom());
      setAddingCustom(false);
    } catch (e) { console.warn('[OpenItemsPanel] save custom error', e); }
    finally { setSavingCustom(false); }
  };

  const handleDeleteCustom = async (docId: string) => {
    try {
      await deleteDoc(doc(db, 'openItems', docId));
      setCustomDocs((prev) => prev.filter((c) => c.id !== docId));
    } catch (e) { console.warn('[OpenItemsPanel] delete custom error', e); }
  };

  // ── render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" />
        <span className="text-[12px] font-medium">Loading open items…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Open Items</span>
            {openCount > 0 && (
              <span className="text-[10px] font-black px-1.5 py-0.5 bg-slate-800 text-white rounded-sm">{openCount}</span>
            )}
            {highCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-sm">
                <AlertTriangle size={9} />{highCount} high
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Auto-aggregated from all tools · {currentGate ? `gate: ${currentGate}` : 'no gate set'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadAll(true)}
            disabled={refreshing}
            title="Reload from all tools — list order unchanged"
            className="flex items-center gap-1 px-2 py-1.5 border border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest hover:border-slate-400 hover:text-slate-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={() => setAddingCustom(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-700 transition-colors"
            >
              <Plus size={12} />Add Item
            </button>
          )}
        </div>
      </div>

      {/* ── Add custom form ── */}
      <AnimatePresence>
        {addingCustom && (
          <motion.div
            key="add-custom"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="border border-slate-200 bg-slate-50 p-4 space-y-3"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">New Custom Item</span>
              <button type="button" onClick={() => { setAddingCustom(false); setCustomDraft(blankCustom()); }}>
                <X size={14} className="text-slate-400 hover:text-slate-700" />
              </button>
            </div>
            <input type="text" placeholder="What needs to be done? *" value={customDraft.title} maxLength={150}
              onChange={(e) => setCustomDraft((d) => ({ ...d, title: e.target.value }))}
              className="w-full bg-white border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-400 outline-none" />
            <div className="grid grid-cols-2 gap-3">
              <input type="text" placeholder="Owner" value={customDraft.assignee} maxLength={40}
                onChange={(e) => setCustomDraft((d) => ({ ...d, assignee: e.target.value }))}
                className="bg-white border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-400 outline-none" />
              <select value={customDraft.priority} onChange={(e) => setCustomDraft((d) => ({ ...d, priority: e.target.value as OpenItemPriority }))}
                className="bg-white border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 outline-none appearance-none cursor-pointer">
                <option value="high">High priority</option>
                <option value="medium">Medium priority</option>
                <option value="low">Low priority</option>
              </select>
            </div>
            <input type="text" placeholder="Notes (optional)" value={customDraft.description} maxLength={200}
              onChange={(e) => setCustomDraft((d) => ({ ...d, description: e.target.value }))}
              className="w-full bg-white border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-400 outline-none" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setAddingCustom(false); setCustomDraft(blankCustom()); }}
                className="px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800 transition-colors">
                Cancel
              </button>
              <button type="button" disabled={!customDraft.title.trim() || savingCustom} onClick={handleSaveCustom}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {savingCustom ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}Save
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          {(['all', 'meeting', 'lesson', 'pfmea', 'decision', 'custom'] as const).map((src) => {
            const isAll  = src === 'all';
            const meta   = isAll ? null : SOURCE_META[src];
            const count  = isAll ? openCount : activeItems.filter((i) => i.source === src).length;
            if (!isAll && count === 0 && filterSource !== src) return null;
            return (
              <button key={src} type="button" onClick={() => setFilterSource(src)}
                className={`text-[10px] font-bold px-2 py-1 border rounded-full transition-colors ${
                  filterSource === src ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                }`}>
                {isAll ? `All (${count})` : `${meta!.label} (${count})`}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          {(['all', 'high', 'medium', 'low'] as const).map((p) => {
            const pmeta = p === 'all' ? null : PRIORITY_META[p];
            return (
              <button key={p} type="button" onClick={() => setFilterPriority(p)}
                className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 border rounded-full transition-colors ${
                  filterPriority === p ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                }`}>
                {pmeta && <span className={`w-1.5 h-1.5 rounded-full ${pmeta.dotClass}`} />}
                {p === 'all' ? 'Any priority' : pmeta!.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── List ── */}
      {visibleItems.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          {openCount === 0 ? (
            <>
              <CheckCircle2 size={32} className="mx-auto mb-3 text-emerald-400" />
              <p className="text-[13px] font-medium text-slate-600">All clear — no open items</p>
              <p className="text-[11px] mt-1">Open items are auto-generated from Meetings, PFMEA, Lessons, and Deliverables.</p>
            </>
          ) : (
            <p className="text-[12px]">No items match the current filter.</p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {visibleItems.map((item) => {
            const meta       = SOURCE_META[item.source];
            const pmeta      = PRIORITY_META[item.priority];
            const SrcIcon    = meta.icon;
            const isClosing    = closingUid    === item.uid;
            const isDismissing = dismissingUid === item.uid;
            const isCustom     = item.source === 'custom';
            const showChip     = item.source !== 'deliverable';
            const ownerValue   = getOwner(item);

            const isPendingResolve = pendingResolveUid === item.uid;
            const closeTitle = item.source === 'pfmea'
              ? 'Log action taken & resolve'
              : item.source === 'decision'
                ? 'Reinstate as active decision'
                : item.closed ? 'Done' : 'Mark as done';

            return (
              <div
                key={item.uid}
                className={`border rounded-sm transition-colors ${
                  item.closed
                    ? 'bg-slate-50 border-slate-100 opacity-50'
                    : isPendingResolve
                      ? 'bg-emerald-50 border-emerald-300'
                      : item.priority === 'high'
                        ? 'bg-white border-l-2 border-l-rose-400 border-t-slate-200 border-r-slate-200 border-b-slate-200'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="px-3 py-2.5 flex items-center gap-2">
                  {/* Check button */}
                  <div className="flex-shrink-0">
                    {item.closeable && !readOnly ? (
                      <button type="button"
                        onClick={() => handleClose(item)}
                        disabled={item.closed || isClosing}
                        className={`transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          isPendingResolve ? 'text-emerald-500' : 'text-slate-400 hover:text-emerald-600'
                        }`}
                        title={closeTitle}>
                        {isClosing
                          ? <Loader2 size={16} className="animate-spin text-slate-400" />
                          : item.closed ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} />}
                      </button>
                    ) : (
                      <span className="text-slate-300">
                        {item.closed ? <CheckCircle2 size={16} className="text-emerald-400" /> : <Circle size={16} />}
                      </span>
                    )}
                  </div>

                  {/* Title + owner inline */}
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className={`text-[12px] font-medium leading-none flex-shrink-0 max-w-[50%] truncate ${item.closed ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                      {item.title}
                    </p>
                    {!item.closed && (
                      <div className="flex items-center gap-1 min-w-0">
                        <User size={9} className="text-slate-300 flex-shrink-0" />
                        {readOnly ? (
                          ownerValue ? <span className="text-[10px] text-slate-500 truncate">{ownerValue}</span> : null
                        ) : (
                          <input
                            type="text"
                            value={ownerValue}
                            onChange={(e) => handleOwnerChange(item.uid, e.target.value)}
                            placeholder="owner"
                            maxLength={40}
                            className="w-24 text-[10px] text-slate-600 placeholder-slate-300 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-300 outline-none transition-colors"
                          />
                        )}
                      </div>
                    )}
                    {item.subtitle && (
                      <p className="text-[10px] text-slate-400 truncate hidden sm:block">{item.subtitle}</p>
                    )}
                  </div>

                  {/* Right meta */}
                  <div className="flex-shrink-0 flex items-center gap-1.5">
                    {/* Priority dot — click to cycle */}
                    {!item.closed && (
                      <button type="button" onClick={() => handleTogglePriority(item)} disabled={readOnly}
                        title={`Priority: ${pmeta.label} — click to change`}
                        className="w-3 h-3 rounded-full transition-transform hover:scale-125 disabled:cursor-default flex-shrink-0">
                        <span className={`block w-3 h-3 rounded-full ${pmeta.dotClass}`} />
                      </button>
                    )}

                    {/* Source chip — hidden for deliverables */}
                    {showChip && (
                      <span className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 border rounded-sm ${meta.chipClass}`}>
                        <SrcIcon size={9} />{meta.label}
                      </span>
                    )}

                    {/* Skip */}
                    {!readOnly && !item.closed && !isPendingResolve && (
                      <button type="button" onClick={() => handleDismiss(item.uid)} disabled={isDismissing}
                        title="Skip — hide without removing from source"
                        className="text-slate-300 hover:text-slate-600 disabled:opacity-40 transition-colors">
                        {isDismissing ? <Loader2 size={11} className="animate-spin" /> : <EyeOff size={11} />}
                      </button>
                    )}

                    {/* Cancel pending resolve */}
                    {isPendingResolve && (
                      <button type="button"
                        onClick={() => { setPendingResolveUid(null); setPendingResolveText(''); }}
                        title="Cancel"
                        className="text-slate-400 hover:text-slate-700 transition-colors">
                        <X size={12} />
                      </button>
                    )}

                    {/* Delete (custom only) */}
                    {isCustom && !readOnly && (
                      <button type="button" onClick={() => handleDeleteCustom(item.sourceDocId)}
                        title="Delete custom item"
                        className="text-slate-300 hover:text-rose-500 transition-colors">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* PFMEA inline resolve form */}
                {isPendingResolve && (
                  <div className="px-3 pb-3 flex items-center gap-2 border-t border-emerald-200 pt-2 mt-0">
                    <ShieldAlert size={11} className="text-emerald-500 flex-shrink-0" />
                    <input
                      autoFocus
                      type="text"
                      value={pendingResolveText}
                      onChange={(e) => setPendingResolveText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && pendingResolveText.trim()) handleClose(item, pendingResolveText);
                        if (e.key === 'Escape') { setPendingResolveUid(null); setPendingResolveText(''); }
                      }}
                      placeholder="What action was taken? (required)"
                      maxLength={200}
                      className="flex-1 text-[11px] text-slate-700 placeholder-slate-400 bg-white border border-emerald-300 rounded px-2 py-1 outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      disabled={!pendingResolveText.trim() || isClosing}
                      onClick={() => handleClose(item, pendingResolveText)}
                      className="flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest rounded hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isClosing ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Show closed ── */}
      {allItems.some((i) => i.closed) && (
        <button type="button" onClick={() => setShowClosed((v) => !v)}
          className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors mt-2">
          <ChevronDown size={12} className={`transition-transform ${showClosed ? 'rotate-180' : ''}`} />
          {showClosed ? 'Hide' : 'Show'} closed ({allItems.filter((i) => i.closed).length})
        </button>
      )}
    </div>
  );
};

export default OpenItemsPanel;
