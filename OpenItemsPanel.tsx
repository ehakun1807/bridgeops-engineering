// ---------------------------------------------------------------------------
// OpenItemsPanel.tsx — Curated open-items view (pinned tab in ProjectDeepDive)
//
// Items come from two sources only:
//   1. Gate-relevant deliverables (auto, filtered by currentGate)
//   2. Items manually pushed here from other tools (openItems Firestore collection)
//
// Auto-aggregation from meetings/PFMEA/decisions was removed — too noisy.
// Users explicitly push items from each tool's "→ Open Items" section.
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, Circle, Plus, Loader2, AlertTriangle,
  ClipboardCheck, SlidersHorizontal,
  ChevronDown, X, EyeOff, RefreshCw, User, Send,
  ShieldAlert, ArrowUpRight, Check,
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
export type OpenItemSource = 'deliverable' | 'custom' | 'meeting' | 'pfmea' | 'lesson' | 'decision' | 'takt' | 'process_map' | 'bom' | 'control_plan';

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

export interface OpenItemDoc {
  userId: string;
  projectId: string;
  title: string;
  description?: string;
  assignee?: string;
  priority: OpenItemPriority;
  status: 'open' | 'closed';
  sourceRef?: { tool: OpenItemSource; docId: string; originalTitle?: string };
  createdAtMs: number;
  updatedAtMs: number;
}

// Shared helper — used by MeetingsTool, PFMEATool, etc.
export async function pushToOpenItems(
  db: Firestore,
  userId: string,
  projectId: string,
  items: Array<{
    title: string;
    priority: OpenItemPriority;
    sourceRef?: { tool: OpenItemSource; docId: string; originalTitle?: string };
  }>
): Promise<void> {
  const now = Date.now();
  await Promise.all(
    items.map((item) =>
      addDoc(collection(db, 'openItems'), {
        userId, projectId,
        title: item.title.trim(),
        priority: item.priority,
        status: 'open',
        ...(item.sourceRef ? { sourceRef: item.sourceRef } : {}),
        createdAtMs: now,
        updatedAtMs: now,
      } satisfies OpenItemDoc)
    )
  );
}

// ---------------------------------------------------------------------------
// Reusable inline push component — import this in any Project Tool
// ---------------------------------------------------------------------------
export interface PushToOpenItemsInlineProps {
  db: Firestore;
  userId: string;
  projectId: string;
  sourceTool: OpenItemSource;
  sourceDocId: string;
  initialTitle?: string;
}

export const PushToOpenItemsInline: React.FC<PushToOpenItemsInlineProps> = ({
  db, userId, projectId, sourceTool, sourceDocId, initialTitle = '',
}) => {
  const [open,   setOpen]   = useState(false);
  const [text,   setText]   = useState('');
  const [prio,   setPrio]   = useState<OpenItemPriority>('medium');
  const [saving, setSaving] = useState(false);
  const [done,   setDone]   = useState(false);

  const handleOpen = () => {
    setText(initialTitle.slice(0, 150));
    setPrio('medium');
    setDone(false);
    setOpen(true);
  };

  const handleSend = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await pushToOpenItems(db, userId, projectId, [{
        title: text.trim(),
        priority: prio,
        sourceRef: { tool: sourceTool, docId: sourceDocId },
      }]);
      setDone(true);
      setTimeout(() => { setOpen(false); setDone(false); }, 1500);
    } catch (e) {
      console.warn('[PushToOpenItemsInline] error', e);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); handleOpen(); }}
        className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest border border-blue-200 text-blue-600 hover:bg-blue-50 rounded-sm transition-colors"
      >
        <ArrowUpRight size={10} />Open Items
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 px-2 py-1.5 rounded-sm" onClick={(e) => e.stopPropagation()}>
      <ArrowUpRight size={11} className="text-blue-500 flex-shrink-0" />
      {done ? (
        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700">
          <Check size={11} /> Added
        </span>
      ) : (
        <>
          <input
            autoFocus
            type="text"
            value={text}
            maxLength={150}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); if (e.key === 'Escape') setOpen(false); }}
            placeholder="Follow-up title…"
            className="flex-1 bg-transparent text-[11px] text-slate-800 placeholder-slate-400 outline-none min-w-0"
          />
          {(['high', 'medium', 'low'] as OpenItemPriority[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPrio(p)}
              className={`text-[9px] font-black uppercase px-1.5 py-0.5 border rounded-sm transition-colors ${
                prio === p
                  ? p === 'high' ? 'bg-rose-500 text-white border-rose-500'
                  : p === 'medium' ? 'bg-amber-400 text-white border-amber-400'
                  : 'bg-slate-400 text-white border-slate-400'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
              }`}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            onClick={handleSend}
            disabled={!text.trim() || saving}
            className="flex items-center gap-1 px-2 py-0.5 bg-blue-600 text-white text-[9px] font-black uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50 transition-colors rounded-sm"
          >
            {saving ? <Loader2 size={9} className="animate-spin" /> : <Send size={9} />}
            Send
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700">
            <X size={12} />
          </button>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SOURCE_LABEL: Partial<Record<OpenItemSource, string>> = {
  meeting:      'Meeting',
  pfmea:        'PFMEA',
  lesson:       'Lesson',
  decision:     'Decision',
  custom:       'Custom',
  takt:         'Study',
  process_map:  'Process',
  bom:          'ECO',
  control_plan: 'Control',
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

const blankCustom = () => ({
  title: '', description: '', assignee: '', priority: 'medium' as OpenItemPriority,
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const OpenItemsPanel: React.FC<OpenItemsPanelProps> = ({
  projectId, userId, db, currentGate, deliverables, onCloseDeliverable, readOnly = false,
}) => {
  // ── data ────────────────────────────────────────────────────────────────
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openDocs,   setOpenDocs]   = useState<Array<{ id: string } & OpenItemDoc>>([]);

  // persisted overrides (priority, dismiss, owner for deliverable items)
  const [dismissedUids,     setDismissedUids]     = useState<Set<string>>(new Set());
  const [priorityOverrides, setPriorityOverrides] = useState<Record<string, OpenItemPriority>>({});
  const [ownerOverrides,    setOwnerOverrides]     = useState<Record<string, string>>({});

  // display order — set once on initial load (priority-sorted), preserved on refresh
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);
  const isFirstLoad = useRef(true);

  // owner editing
  const [ownerDrafts,    setOwnerDrafts]    = useState<Record<string, string>>({});
  const ownerSaveTimers                      = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // PFMEA inline resolve
  const [pendingResolveUid,  setPendingResolveUid]  = useState<string | null>(null);
  const [pendingResolveText, setPendingResolveText] = useState('');

  // ── UI ───────────────────────────────────────────────────────────────────
  const [filterSource,   setFilterSource]   = useState<OpenItemSource | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<OpenItemPriority | 'all'>('all');
  const [showClosed,     setShowClosed]     = useState(false);
  const [closingUid,     setClosingUid]     = useState<string | null>(null);
  const [dismissingUid,  setDismissingUid]  = useState<string | null>(null);
  const [addingCustom,   setAddingCustom]   = useState(false);
  const [customDraft,    setCustomDraft]    = useState(blankCustom());
  const [savingCustom,   setSavingCustom]   = useState(false);
  const [saveCustomError, setSaveCustomError] = useState<string | null>(null);
  const [persistError,   setPersistError]   = useState<string | null>(null);

  // ── load ─────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [itemsSnap, metaSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'openItems'),
          where('userId', '==', userId),
          where('projectId', '==', projectId)
        )),
        getDoc(doc(db, 'openItemsDismissed', metaDocId(userId, projectId))),
      ]);

      setOpenDocs(itemsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as OpenItemDoc) })));

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

  // ── persist metadata ──────────────────────────────────────────────────────
  const persistMetadata = useCallback(async (
    uids: Set<string>,
    pOverrides: Record<string, OpenItemPriority>,
    oOverrides: Record<string, string>
  ) => {
    try {
      setPersistError(null);
      await setDoc(
        doc(db, 'openItemsDismissed', metaDocId(userId, projectId)),
        { userId, projectId, dismissedUids: Array.from(uids), priorityOverrides: pOverrides, ownerOverrides: oOverrides },
        { merge: false }
      );
    } catch (e) {
      console.warn('[OpenItemsPanel] persist metadata error', e);
      const msg = (e as any)?.message ?? 'Unknown error';
      setPersistError(
        msg.includes('insufficient permissions')
          ? 'Changes not saved: Firestore rules not deployed — paste firestore.rules into Firebase Console → Firestore → Rules → Publish.'
          : `Save failed: ${msg}`
      );
    }
  }, [db, userId, projectId]);

  // ── deliverable items (gate-filtered) ────────────────────────────────────
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
            uid: `deliverable-${rampItem.id}-${td.id}`,
            source: 'deliverable', sourceDocId: rampItem.id,
            title: td.title, subtitle: `${rampItem.title} · due ${currentGate}`,
            priority: 'medium', closeable: true, closed: false,
          });
        }
      }
    }
    return items;
  }, [deliverables, currentGate]);

  // ── build raw items ───────────────────────────────────────────────────────
  const rawItems = useMemo((): UnifiedOpenItem[] => {
    const fromDocs: UnifiedOpenItem[] = openDocs.map((d) => ({
      uid: `custom-${d.id}`,
      source: (d.sourceRef?.tool ?? 'custom') as OpenItemSource,
      sourceDocId: d.id,
      title: d.title,
      subtitle: d.sourceRef ? `from ${SOURCE_LABEL[d.sourceRef.tool] ?? d.sourceRef.tool}` : d.description?.slice(0, 80),
      priority: d.priority,
      closeable: true,
      closed: d.status === 'closed',
    }));
    return [...fromDocs, ...deliverableItems];
  }, [openDocs, deliverableItems]);

  // ── display order — set once, preserved on refresh ────────────────────────
  useEffect(() => {
    if (rawItems.length === 0) return;
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      const sorted = [...rawItems].sort((a, b) => {
        if (a.closed !== b.closed) return a.closed ? 1 : -1;
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      });
      setDisplayOrder(sorted.map((i) => i.uid));
    } else {
      setDisplayOrder((prev) => {
        const currentSet = new Set(rawItems.map((i) => i.uid));
        const prevSet    = new Set(prev);
        const hasChange  = rawItems.some((i) => !prevSet.has(i.uid)) || prev.some((u) => !currentSet.has(u));
        if (!hasChange) return prev;
        const valid  = prev.filter((u) => currentSet.has(u));
        const newIds = rawItems.filter((i) => !prevSet.has(i.uid)).map((i) => i.uid);
        return [...valid, ...newIds];
      });
    }
  }, [rawItems]);

  // ── apply overrides (no sort) ─────────────────────────────────────────────
  const allItems = useMemo((): UnifiedOpenItem[] =>
    rawItems.map((item) =>
      priorityOverrides[item.uid] ? { ...item, priority: priorityOverrides[item.uid] } : item
    ),
    [rawItems, priorityOverrides]
  );

  const itemMap = useMemo(() => new Map(allItems.map((i) => [i.uid, i])), [allItems]);

  // ── re-sort after manual priority toggle ──────────────────────────────────
  const resortByPriority = useCallback((effectiveOverrides: Record<string, OpenItemPriority>) => {
    setDisplayOrder((prev) => {
      const infoMap = new Map<string, { priority: OpenItemPriority; closed: boolean }>(
        rawItems.map((i) => [i.uid, {
          priority: effectiveOverrides[i.uid] ?? i.priority,
          closed: i.closed,
        }])
      );
      const open   = prev.filter((u) => infoMap.has(u) && !infoMap.get(u)!.closed);
      const closed = prev.filter((u) => infoMap.has(u) &&  infoMap.get(u)!.closed);
      open.sort((a, b) =>
        PRIORITY_ORDER[infoMap.get(a)!.priority] - PRIORITY_ORDER[infoMap.get(b)!.priority]
      );
      return [...open, ...closed];
    });
  }, [rawItems]);

  // ── visible items ─────────────────────────────────────────────────────────
  const visibleItems = useMemo(() => {
    const ordered = displayOrder.map((u) => itemMap.get(u)).filter((i): i is UnifiedOpenItem => !!i);
    return ordered.filter((item) => {
      if (dismissedUids.has(item.uid))                                  return false;
      if (!showClosed && item.closed)                                   return false;
      if (filterSource   !== 'all' && item.source   !== filterSource)   return false;
      if (filterPriority !== 'all' && item.priority !== filterPriority) return false;
      return true;
    });
  }, [displayOrder, itemMap, dismissedUids, showClosed, filterSource, filterPriority]);

  const activeItems = allItems.filter((i) => !i.closed && !dismissedUids.has(i.uid));
  const openCount   = activeItems.length;
  const highCount   = activeItems.filter((i) => i.priority === 'high').length;

  // ── handlers ──────────────────────────────────────────────────────────────
  const handleDismiss = async (uid: string) => {
    if (readOnly) return;
    setDismissingUid(uid);
    const next = new Set(dismissedUids); next.add(uid);
    setDismissedUids(next);
    await persistMetadata(next, priorityOverrides, ownerOverrides);
    setDismissingUid(null);
  };

  const handleTogglePriority = async (item: UnifiedOpenItem) => {
    if (readOnly || item.closed) return;
    const next: OpenItemPriority = PRIORITY_CYCLE[item.priority];
    if (item.source === 'deliverable') {
      // deliverables use priorityOverrides only
      const nextOverrides = { ...priorityOverrides, [item.uid]: next };
      setPriorityOverrides(nextOverrides);
      await persistMetadata(dismissedUids, nextOverrides, ownerOverrides);
      resortByPriority(nextOverrides);
    } else {
      // openItems doc — update priority in Firestore
      try {
        await updateDoc(doc(db, 'openItems', item.sourceDocId), { priority: next, updatedAtMs: Date.now() });
        setOpenDocs((prev) => prev.map((d) => d.id === item.sourceDocId ? { ...d, priority: next } : d));
        resortByPriority({ ...priorityOverrides, [item.uid]: next });
        setPersistError(null);
      } catch (e) {
        console.warn('[OpenItemsPanel] toggle priority error', e);
        const msg = (e as any)?.message ?? 'Unknown error';
        setPersistError(msg.includes('insufficient permissions') ? 'Changes not saved: Firestore rules not deployed — paste firestore.rules into Firebase Console → Rules → Publish.' : `Save failed: ${msg}`);
      }
    }
  };

  const handleOwnerChange = (uid: string, value: string) => {
    setOwnerDrafts((prev) => ({ ...prev, [uid]: value }));
    clearTimeout(ownerSaveTimers.current[uid]);
    ownerSaveTimers.current[uid] = setTimeout(async () => {
      const oDoc = openDocs.find((d) => `custom-${d.id}` === uid);
      if (oDoc) {
        try {
          await updateDoc(doc(db, 'openItems', oDoc.id), { assignee: value.trim(), updatedAtMs: Date.now() });
          setOpenDocs((prev) => prev.map((d) => d.id === oDoc.id ? { ...d, assignee: value.trim() } : d));
          setPersistError(null);
        } catch (e) {
          console.warn('[OpenItemsPanel] owner update error', e);
          const msg = (e as any)?.message ?? 'Unknown error';
          setPersistError(msg.includes('insufficient permissions') ? 'Changes not saved: Firestore rules not deployed — paste firestore.rules into Firebase Console → Rules → Publish.' : `Save failed: ${msg}`);
        }
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
    const oDoc = openDocs.find((d) => `custom-${d.id}` === item.uid);
    if (oDoc) return oDoc.assignee || '';
    return ownerOverrides[item.uid] || '';
  };

  const handleClose = async (item: UnifiedOpenItem, resolveText?: string) => {
    if (!item.closeable || item.closed || readOnly) return;
    setClosingUid(item.uid);
    try {
      if (item.source === 'deliverable') {
        const tdId = item.uid.slice(`deliverable-${item.sourceDocId}-`.length);
        await onCloseDeliverable(item.sourceDocId, tdId);
      } else {
        await updateDoc(doc(db, 'openItems', item.sourceDocId), { status: 'closed', updatedAtMs: Date.now() });
        setOpenDocs((prev) => prev.map((d) => d.id === item.sourceDocId ? { ...d, status: 'closed' } : d));
        logActivity({ userId, projectId, eventType: 'open_item_closed', tool: 'open_items', title: `Closed: ${item.title.slice(0, 60)}`, timestampMs: Date.now() });
      }
    } catch (e) { console.warn('[OpenItemsPanel] close error', e); }
    finally { setClosingUid(null); }
  };

  const handleDeleteItem = async (docId: string) => {
    try {
      await deleteDoc(doc(db, 'openItems', docId));
      setOpenDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch (e) { console.warn('[OpenItemsPanel] delete error', e); }
  };

  const handleSaveCustom = async () => {
    if (!customDraft.title.trim()) return;
    setSavingCustom(true);
    try {
      const payload: OpenItemDoc = {
        userId, projectId,
        title: customDraft.title.trim(),
        ...(customDraft.description.trim() ? { description: customDraft.description.trim() } : {}),
        ...(customDraft.assignee.trim()    ? { assignee:    customDraft.assignee.trim()    } : {}),
        priority: customDraft.priority, status: 'open',
        createdAtMs: Date.now(), updatedAtMs: Date.now(),
      };
      const ref = await addDoc(collection(db, 'openItems'), payload);
      setOpenDocs((prev) => [...prev, { id: ref.id, ...payload }]);
      logActivity({ userId, projectId, eventType: 'open_item_created', tool: 'open_items', title: `Added: ${payload.title.slice(0, 60)}`, timestampMs: Date.now() });
      setCustomDraft(blankCustom());
      setAddingCustom(false);
    } catch (e) {
      console.warn('[OpenItemsPanel] save custom error', e);
      const msg = (e as any)?.message ?? 'Unknown error';
      setSaveCustomError(
        msg.includes('insufficient permissions')
          ? 'Save failed: Firestore rules not deployed. Paste firestore.rules into Firebase Console → Firestore → Rules → Publish.'
          : `Save failed: ${msg}`
      );
    }
    finally { setSavingCustom(false); }
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
      {/* Persist error banner */}
      {persistError && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded px-3 py-2 text-[11px] text-rose-700">
          <span className="flex-1">{persistError}</span>
          <button type="button" onClick={() => setPersistError(null)} className="flex-shrink-0 text-rose-400 hover:text-rose-700"><X size={12} /></button>
        </div>
      )}
      {/* Header */}
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
            Manually pushed from tools · {currentGate ? `gate deliverables: ${currentGate}` : 'no gate set'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => loadAll(true)} disabled={refreshing}
            className="flex items-center gap-1 px-2 py-1.5 border border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest hover:border-slate-400 hover:text-slate-700 disabled:opacity-50 transition-colors">
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {!readOnly && (
            <button type="button" onClick={() => setAddingCustom(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-700 transition-colors">
              <Plus size={12} />Add Item
            </button>
          )}
        </div>
      </div>

      {/* Add custom form */}
      <AnimatePresence>
        {addingCustom && (
          <motion.div key="add-custom" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">New Item</span>
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
            {saveCustomError && (
              <div className="bg-rose-50 border border-rose-200 rounded px-3 py-2 text-[11px] text-rose-700">{saveCustomError}</div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setAddingCustom(false); setCustomDraft(blankCustom()); setSaveCustomError(null); }}
                className="px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800 transition-colors">Cancel</button>
              <button type="button" disabled={!customDraft.title.trim() || savingCustom} onClick={handleSaveCustom}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {savingCustom ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}Save
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filters */}
      {allItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 flex-wrap">
            {(['all', 'meeting', 'pfmea', 'lesson', 'decision', 'custom', 'deliverable'] as const).map((src) => {
              const isAll  = src === 'all';
              const count  = isAll ? openCount : activeItems.filter((i) => i.source === src).length;
              if (!isAll && count === 0 && filterSource !== src) return null;
              const label  = isAll ? 'All' : SOURCE_LABEL[src] ?? src;
              return (
                <button key={src} type="button" onClick={() => setFilterSource(src)}
                  className={`text-[10px] font-bold px-2 py-1 border rounded-full transition-colors ${
                    filterSource === src ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                  }`}>
                  {label} ({count})
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
      )}

      {/* List */}
      {visibleItems.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          {openCount === 0 ? (
            <>
              <CheckCircle2 size={32} className="mx-auto mb-3 text-emerald-400" />
              <p className="text-[13px] font-medium text-slate-600">No open items</p>
              <p className="text-[11px] mt-1 max-w-sm mx-auto">
                Push action items here from Meetings, PFMEA risks, or Lessons using the "→ Open Items" button in each tool.
                {currentGate && ' Gate deliverables appear automatically.'}
              </p>
            </>
          ) : (
            <p className="text-[12px]">No items match the current filter.</p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {visibleItems.map((item) => {
            const pmeta        = PRIORITY_META[item.priority];
            const isClosing    = closingUid   === item.uid;
            const isDismissing = dismissingUid === item.uid;
            const isDeliverable = item.source === 'deliverable';
            const ownerValue   = getOwner(item);
            const srcLabel     = SOURCE_LABEL[item.source];

            return (
              <div key={item.uid}
                className={`border rounded-sm transition-colors ${
                  item.closed
                    ? 'bg-slate-50 border-slate-100 opacity-50'
                    : item.priority === 'high'
                      ? 'bg-white border-l-2 border-l-rose-400 border-t-slate-200 border-r-slate-200 border-b-slate-200'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="px-3 py-2 flex items-start gap-2">
                  {/* Check */}
                  <div className="flex-shrink-0 pt-0.5">
                    {item.closeable && !readOnly ? (
                      <button type="button" onClick={() => handleClose(item)} disabled={item.closed || isClosing}
                        className="text-slate-400 hover:text-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        title={item.closed ? 'Done' : 'Mark as done'}>
                        {isClosing
                          ? <Loader2 size={15} className="animate-spin text-slate-400" />
                          : item.closed ? <CheckCircle2 size={15} className="text-emerald-500" /> : <Circle size={15} />}
                      </button>
                    ) : (
                      <span className="text-slate-300">
                        {item.closed ? <CheckCircle2 size={15} className="text-emerald-400" /> : <Circle size={15} />}
                      </span>
                    )}
                  </div>

                  {/* Title + owner (stacked) */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-[12px] font-medium leading-snug truncate ${item.closed ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                      {item.title}
                    </p>
                    {!item.closed && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <User size={9} className="text-slate-300 flex-shrink-0" />
                        {readOnly
                          ? ownerValue ? <span className="text-[10px] text-slate-500">{ownerValue}</span> : null
                          : <input type="text" value={ownerValue} onChange={(e) => handleOwnerChange(item.uid, e.target.value)}
                              placeholder="owner" maxLength={40}
                              className="w-28 text-[10px] text-slate-600 placeholder-slate-300 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-300 outline-none transition-colors" />
                        }
                      </div>
                    )}
                  </div>

                  {/* Right meta */}
                  <div className="flex-shrink-0 flex items-center gap-1.5 pt-0.5">
                    {/* Priority dot */}
                    {!item.closed && (
                      <button type="button" onClick={() => handleTogglePriority(item)} disabled={readOnly}
                        title={`Priority: ${pmeta.label} — click to change`}
                        className="w-3 h-3 rounded-full transition-transform hover:scale-125 disabled:cursor-default flex-shrink-0">
                        <span className={`block w-3 h-3 rounded-full ${pmeta.dotClass}`} />
                      </button>
                    )}

                    {/* Source chip */}
                    {srcLabel && (
                      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-sm">
                        {srcLabel}
                      </span>
                    )}
                    {isDeliverable && (
                      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-sm flex items-center gap-1">
                        <ClipboardCheck size={9} />{currentGate ? `${currentGate} Gate` : 'Gate'}
                      </span>
                    )}

                    {/* Skip */}
                    {!readOnly && !item.closed && (
                      <button type="button" onClick={() => handleDismiss(item.uid)} disabled={isDismissing}
                        title="Skip — hide without removing" className="text-slate-300 hover:text-slate-600 disabled:opacity-40 transition-colors">
                        {isDismissing ? <Loader2 size={11} className="animate-spin" /> : <EyeOff size={11} />}
                      </button>
                    )}

                    {/* Delete (non-deliverable only) */}
                    {!isDeliverable && !readOnly && (
                      <button type="button" onClick={() => handleDeleteItem(item.sourceDocId)}
                        title="Remove from Open Items" className="text-slate-300 hover:text-rose-500 transition-colors">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Show closed */}
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
