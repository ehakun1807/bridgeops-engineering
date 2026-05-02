// ---------------------------------------------------------------------------
// ProjectDeepDive — per-project workspace. Shown when a project is selected
// from the Dashboard's Active / Archived list.
//
// Renders the 4 "father" Ramp Readiness parameter groups (see rampGroups.ts)
// with their measurable sub-items. Users can update metrics live; progress
// bars animate and the rollup score updates immediately. Metric values are
// persisted to the project document in Firestore (under `project.metrics`).
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Archive,
  CheckCircle2,
  Loader2,
  Save,
  AlertTriangle,
  TrendingUp,
  XCircle,
  Undo2,
  Info,
  ClipboardList,
  Calendar as CalendarIcon,
  Link as LinkIcon,
  FileText,
  Image as ImageIcon,
  Mail,
  File as FileIcon,
  Trash2,
  ExternalLink,
  Plus,
  Sparkles,
  Download,
  LineChart as LineChartIcon,
  ChevronDown,
  Square,
  CheckSquare,
  X,
  FileWarning,
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth } from './firebase.ts';
import { doc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import {
  RAMP_GROUPS,
  RampSubItem,
  accentTokens,
  defaultMetricValues,
  scoreBand,
  scoreForGroup,
  scoreForItem,
  scoreForProject,
  enabledCountForProject,
  PRODUCT_GATE_ORDER,
  gateIndex
} from './rampGroups';
import { getTemplate, TOTAL_ITEM_COUNT } from './templates';
import AIAnalysisPanel from './AIAnalysisPanel.tsx';
import ScoreHistoryPanel from './ScoreHistoryPanel.tsx';
import ScopeEditor from './ScopeEditor.tsx';
import CoachPanel from './CoachPanel.tsx';
import StandardsPicker from './StandardsPicker.tsx';
import {
  fetchCoachAdvice,
  submitCoachFeedback,
  type CoachAdvice
} from './coachClient.ts';
import type { AIAnalysis } from './aiClient';
import { generateExecutiveSummary } from './pptxGenerator';

export type InfoStatus = 'TBD' | 'In Process' | 'Completed' | 'Cancelled';

// Classic hardware stage gates + an MP (Mass Production) state for projects
// that have shipped and are in sustaining / ramp-run. Legacy projects saved
// with the old 'Post-PRR' label are normalized to 'MP' on read.
export type ProductGate = 'CR' | 'PDR' | 'CDR' | 'TRR' | 'PRR' | 'MP';

export interface ProjectAttachment {
  name: string;
  url: string;
  addedAt: number; // Date.now()
}

// A single point-in-time readiness snapshot. Written on Save when any score
// changed; used by the History tab's trend chart and the Portfolio heatmap's
// spark values. Capped to the most-recent SCORE_HISTORY_LIMIT entries.
export interface ScoreSnapshot {
  ts: number;                        // Date.now()
  overall: number;                   // 0-100
  groups: Record<string, number>;    // group.id -> 0-100
  currentGate?: ProductGate;         // gate at the time of snapshot
}

export const SCORE_HISTORY_LIMIT = 500;

// User-added deliverable on top of the curated master list. Decoupled from
// scoring — purely a tracking aid for what work is required.
export interface CustomDeliverable {
  id: string;     // 'custom_<ts>_<rand>'
  title: string;
  done: boolean;
  // Optional gate assignment so custom items appear in gate-readiness views
  // alongside curated ones. Undefined = "not assigned to a gate".
  dueBy?: ProductGate;
  // Waiver / deviation (ISO 9001 §8.7, AS9100 §8.7.1, IATF 16949 §8.7.1.4).
  // A waived deliverable is formally accepted as "not going to be done" and
  // counts as satisfied for gate readiness. The reason is required by most
  // QMS frameworks, so we capture it at the same time.
  waived?: boolean;
  waiverReason?: string;
  waivedAt?: number;    // Date.now() — for audit display
}

// Per-sub-item deliverable state. checkedIds may reference either curated
// template ids (from rampGroups.ts) OR custom item ids. Custom items live
// alongside as their own list so we can render them with edit/remove controls.
// `hiddenTemplateIds` lets the user hide curated deliverables that don't
// apply to their project — they're not deleted from the template, just
// filtered out of the view and can be restored from the "hidden" region.
// `waivedTemplateIds` is the analog of checkedIds for the waive action on
// curated deliverables — it marks templated items as formally waived.
// `waiverReasons` keyed by (template id OR custom id) captures the free-text
// justification that QMS frameworks (ISO 9001 §8.7, AS9100, IATF 16949)
// require for a deviation/waiver.
export interface SubItemDeliverables {
  checkedIds: string[];
  custom?: CustomDeliverable[];
  hiddenTemplateIds?: string[];
  waivedTemplateIds?: string[];
  waiverReasons?: Record<string, string>;
  waivedAt?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Deliverable-driven progress helper.
//
// For bar-kind sub-parameters that have deliverables attached (template and/or
// custom), the slider value should mirror the fraction of deliverables that
// are done. One deliverable checked out of two = 50%. Waived deliverables
// count as delivered per QMS practice (formally excused = satisfies the
// gate). Hidden template deliverables are excluded from both numerator and
// denominator — the user said they don't apply.
//
// Returns null when there are no deliverables at all; the caller falls back
// to the manual slider in that case so bar-kind items without a checklist
// still work the way they did before.
// ---------------------------------------------------------------------------
function deliverablePctForItem(
  item: RampSubItem,
  state: SubItemDeliverables | undefined
): number | null {
  const s: SubItemDeliverables = state || { checkedIds: [] };
  const hidden = new Set(s.hiddenTemplateIds || []);
  const checked = new Set(s.checkedIds || []);
  const waived = new Set(s.waivedTemplateIds || []);
  const templateItems = (item.deliverables || []).filter((t) => !hidden.has(t.id));
  const customItems = s.custom || [];
  const total = templateItems.length + customItems.length;
  if (total === 0) return null;
  let done = 0;
  for (const t of templateItems) {
    if (waived.has(t.id) || checked.has(t.id)) done += 1;
  }
  for (const c of customItems) {
    if (c.waived || c.done) done += 1;
  }
  return Math.round((done / total) * 100);
}

// Small counts companion used by the UI to render "Auto · 3/5 delivered"
// chips next to the bar. Mirrors the filters in deliverablePctForItem.
function deliverableCountsForItem(
  item: RampSubItem,
  state: SubItemDeliverables | undefined
): { done: number; total: number } {
  const s: SubItemDeliverables = state || { checkedIds: [] };
  const hidden = new Set(s.hiddenTemplateIds || []);
  const checked = new Set(s.checkedIds || []);
  const waived = new Set(s.waivedTemplateIds || []);
  const templateItems = (item.deliverables || []).filter((t) => !hidden.has(t.id));
  const customItems = s.custom || [];
  let done = 0;
  for (const t of templateItems) {
    if (waived.has(t.id) || checked.has(t.id)) done += 1;
  }
  for (const c of customItems) {
    if (c.waived || c.done) done += 1;
  }
  return { done, total: templateItems.length + customItems.length };
}

// Project-local sub-parameter added by the user on top of the template. These
// are purely informational — they render and track like a `bar` metric but
// DO NOT participate in the group score or the overall rollup. Scoped to a
// specific RAMP_GROUPS bucket via `groupId`.
export interface CustomSubItem {
  id: string;        // 'csub_<ts>_<rand>' — stable for the life of the project
  groupId: string;   // must match a RAMP_GROUPS[].id
  title: string;     // user-entered label (required)
  question?: string; // optional description / help text
  value: number;     // 0-100 progress value
  note?: string;     // free-text notes (max NOTE_MAX chars)
}

export interface DeepDiveProject {
  id: string;
  userId?: string;
  name: string;
  description?: string;
  status: 'active' | 'completed' | 'cancelled' | 'archived';
  metrics?: Record<string, number>;
  notes?: Record<string, string>;
  deliverables?: Record<string, SubItemDeliverables>; // keyed by sub-item id
  // Project-local custom sub-parameters. Phase 1: informational only —
  // not reflected in scoreForGroup / scoreForProject. See CustomSubItem.
  customSubItems?: CustomSubItem[];
  // Scope profile — which template the project was created from (display-only)
  // and the current list of disabled sub-item IDs. Absent = all enabled.
  templateId?: string;
  disabledItemIds?: string[];
  productType?: string;
  // Applicable ISO / world standards the user flagged as relevant to this
  // project. Scoped by productType via productStandards.STANDARDS_BY_SEGMENT
  // but the list is free-form on disk (so renaming / adding entries to the
  // catalog never orphans a saved project). Feeds the Coacher prompt and
  // the ai-analyze risk assessment.
  standards?: string[];
  createdAt?: Timestamp;
  closedAt?: Timestamp;
  closeReason?: 'completed' | 'cancelled';
  // General-info tab fields
  startDate?: string;   // ISO 'YYYY-MM-DD'
  endDate?: string;     // ISO 'YYYY-MM-DD'
  infoStatus?: InfoStatus;
  generalInfo?: string;
  attachments?: ProjectAttachment[];
  // Stage-gate tracking
  currentGate?: ProductGate;
  gateTargets?: Partial<Record<ProductGate, string>>; // gate -> ISO date
  // Time-series of readiness scores — appended on Save when a value changed.
  scoreHistory?: ScoreSnapshot[];
  // AI Analysis cache — last Gemini result, so reopens don't re-bill
  aiAnalysis?: AIAnalysis;
}

const NOTE_MAX = 200;
const GENERAL_INFO_MAX = 400;
const ATTACHMENT_NAME_MAX = 80;
const GENERAL_INFO_TAB_ID = '__general_info__';
const AI_ANALYSIS_TAB_ID = '__ai_analysis__';
const HISTORY_TAB_ID = '__history__';
const INFO_STATUS_OPTIONS: InfoStatus[] = ['TBD', 'In Process', 'Completed', 'Cancelled'];
const GATE_OPTIONS: ProductGate[] = ['CR', 'PDR', 'CDR', 'TRR', 'PRR', 'MP'];
const GATE_LABELS: Record<ProductGate, string> = {
  'CR':  'CR — Concept Review',
  'PDR': 'PDR — Preliminary Design Review',
  'CDR': 'CDR — Critical Design Review',
  'TRR': 'TRR — Test Readiness Review',
  'PRR': 'PRR — Production Readiness Review',
  'MP':  'MP — Mass Production'
};

// Normalize a legacy or unknown gate value to a valid ProductGate. Written
// once here so every read path (projects, score snapshots, gateTargets,
// custom deliverable dueBy, template dueBy) uses the same mapping.
const normalizeGate = (g: unknown): ProductGate | undefined => {
  if (typeof g !== 'string') return undefined;
  if (g === 'Post-PRR') return 'MP'; // legacy label
  if ((PRODUCT_GATE_ORDER as string[]).includes(g)) return g as ProductGate;
  return undefined;
};

// Recursively strip `undefined` values from plain objects / arrays before we
// hand them to Firestore. updateDoc() throws ("Unsupported field value:
// undefined") if any leaf is undefined, so this is the last line of defense
// against data like `{ dueBy: undefined }` sneaking through.
//
// We preserve Firestore sentinels (serverTimestamp, Timestamp, FieldValue)
// and Date objects untouched — they're not plain objects but Firestore
// handles them natively.
const isFirestoreSpecial = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object') return false;
  if (value instanceof Date) return true;
  if (value instanceof Timestamp) return true;
  // FieldValue instances (serverTimestamp, deleteField, etc.) have a
  // non-plain prototype but aren't one of the above. Treat any non-plain
  // object whose constructor name contains "Field" or "Timestamp" as a
  // Firestore sentinel.
  const ctorName = (value as { constructor?: { name?: string } })?.constructor?.name || '';
  return /Field|Timestamp|Reference|GeoPoint|Bytes/.test(ctorName);
};

const stripUndefined = <T,>(value: T): T => {
  if (value === undefined) return value;
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== undefined)
      .map((v) => stripUndefined(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    if (isFirestoreSpecial(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as unknown as T;
  }
  return value;
};

// Diagnostic: walks a payload and returns the dotted path of the first
// `undefined` leaf it finds. Used to produce an actionable error message
// when Firestore rejects a save with "Unsupported field value: undefined".
const findUndefinedPath = (value: unknown, path = ''): string | null => {
  if (value === undefined) return path || '<root>';
  if (value === null) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const p = findUndefinedPath(value[i], `${path}[${i}]`);
      if (p) return p;
    }
    return null;
  }
  if (typeof value === 'object') {
    if (isFirestoreSpecial(value)) return null;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = findUndefinedPath(v, path ? `${path}.${k}` : k);
      if (p) return p;
    }
  }
  return null;
};

// Tailwind tokens for gate chips — background + text color per gate.
// Kept subdued so the chip reads as metadata, not a call-to-action.
const GATE_CHIP_STYLES: Record<ProductGate, string> = {
  'CR':       'bg-slate-100 text-slate-700 border-slate-200',
  'PDR':      'bg-blue-50 text-blue-700 border-blue-200',
  'CDR':      'bg-indigo-50 text-indigo-700 border-indigo-200',
  'TRR':      'bg-amber-50 text-amber-700 border-amber-200',
  'PRR':      'bg-rose-50 text-rose-700 border-rose-200',
  'MP':       'bg-emerald-50 text-emerald-700 border-emerald-200'
};

// Walk every gate-valued field on a project and coerce legacy values
// (e.g. 'Post-PRR') to the current gate vocabulary. Returns a shallow clone
// — the original object is not mutated. Safe to call on fresh projects;
// it becomes a no-op when everything is already in the new vocabulary.
const migrateProjectGates = (p: DeepDiveProject): DeepDiveProject => {
  const out: DeepDiveProject = { ...p };

  if (p.currentGate !== undefined) {
    out.currentGate = normalizeGate(p.currentGate);
  }

  if (p.gateTargets) {
    const migrated: Partial<Record<ProductGate, string>> = {};
    for (const [k, v] of Object.entries(p.gateTargets)) {
      const g = normalizeGate(k);
      if (g && typeof v === 'string' && v) migrated[g] = v;
    }
    out.gateTargets = migrated;
  }

  if (Array.isArray(p.scoreHistory) && p.scoreHistory.length > 0) {
    out.scoreHistory = p.scoreHistory.map((s) => {
      if (s.currentGate === undefined) return s;
      const g = normalizeGate(s.currentGate);
      return g === s.currentGate ? s : { ...s, currentGate: g };
    });
  }

  if (p.deliverables) {
    const nextDeliverables: Record<string, SubItemDeliverables> = {};
    let changed = false;
    for (const [subId, state] of Object.entries(p.deliverables)) {
      if (!state.custom || state.custom.length === 0) {
        nextDeliverables[subId] = state;
        continue;
      }
      let subChanged = false;
      const migratedCustom = state.custom.map((c) => {
        if (c.dueBy === undefined) return c;
        const g = normalizeGate(c.dueBy);
        if (g === c.dueBy) return c;
        subChanged = true;
        return { ...c, dueBy: g };
      });
      if (subChanged) {
        changed = true;
        nextDeliverables[subId] = { ...state, custom: migratedCustom };
      } else {
        nextDeliverables[subId] = state;
      }
    }
    if (changed) out.deliverables = nextDeliverables;
  }

  return out;
};

// ---------------------------------------------------------------------------
// Gate-readiness strip — shows one pill per NPI stage gate with the
// percentage of deliverables (due-by that gate) that are checked. The
// currently-active gate (as set on the General Info tab) gets a ring so the
// user can see "where am I, and am I ready to pass this gate?" at a glance.
// ---------------------------------------------------------------------------

const GateReadinessStrip: React.FC<{
  readiness: Record<ProductGate, { required: number; done: number; waived: number }>;
  currentGate: ProductGate | null;
}> = ({ readiness, currentGate }) => {
  // If no gate has any required deliverables, render nothing — it would
  // just be six empty pills taking up space.
  const totalRequired = PRODUCT_GATE_ORDER.reduce(
    (acc, g) => acc + readiness[g].required,
    0
  );
  if (totalRequired === 0) return null;

  return (
    <div className="mb-6 bg-white border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          Gate readiness
        </div>
        {currentGate && (
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Current:{' '}
            <span className="text-slate-700">{currentGate}</span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {PRODUCT_GATE_ORDER.map((gate) => {
          const { required, done, waived } = readiness[gate];
          const pct = required > 0 ? Math.round((done / required) * 100) : 0;
          const isActive = gate === currentGate;
          const band = scoreBand(pct);
          const empty = required === 0;

          return (
            <div
              key={gate}
              className={`relative border px-3 py-2 transition-all ${
                empty
                  ? 'bg-slate-50 border-slate-200 opacity-60'
                  : GATE_CHIP_STYLES[gate]
              } ${isActive ? 'ring-2 ring-slate-900 ring-offset-1' : ''}`}
            >
              {/* Amber dot when one or more satisfied items are waivers, not
                  completions. Visible without affecting the %. */}
              {waived > 0 && (
                <span
                  className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-amber-500"
                  title={`${waived} waived`}
                  aria-label={`${waived} waived`}
                />
              )}
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-black uppercase tracking-widest">
                  {gate}
                </span>
                <span
                  className={`text-[10px] font-black tabular-nums ${
                    empty ? 'text-slate-400' : band.text
                  }`}
                >
                  {empty ? '—' : `${pct}%`}
                </span>
              </div>
              {/* Progress bar — only rendered when there is something to track. */}
              {!empty && (
                <div className="h-1 bg-white/60 border border-white/80 overflow-hidden">
                  <div
                    className={`h-full ${band.bg} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              <div
                className={`mt-1 text-[9px] font-medium tabular-nums ${
                  empty ? 'text-slate-400' : 'text-slate-600'
                }`}
              >
                {empty
                  ? 'No items'
                  : waived > 0
                  ? `${done}/${required} done · ${waived} waived`
                  : `${done}/${required} done`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface ProjectDeepDiveProps {
  project: DeepDiveProject;
  onBack: () => void;
  readOnly?: boolean; // true for archived projects
}

const ProjectDeepDive: React.FC<ProjectDeepDiveProps> = ({
  project,
  onBack,
  readOnly = false
}) => {
  // Editable identity — name + product type can be changed post-creation
  // from the General Info panel. Kept in local state so changes show in
  // the header instantly and get flushed on Save.
  const [projectName, setProjectName] = useState<string>(project.name);
  const [productType, setProductType] = useState<string>(project.productType || '');
  // Applicable ISO/world standards picked for this project. Threaded into the
  // Coacher prompt (soft-preference for referenceStandards) and the AI risk
  // analysis so compliance-readiness is weighed against what the user
  // actually needs to meet. Persisted on edit via saveStandards below.
  const [projectStandards, setProjectStandards] = useState<string[]>(
    project.standards || []
  );

  // Normalize legacy gate vocabulary (e.g. 'Post-PRR' → 'MP') before we
  // seed any gate-valued state. Cheap enough to run every render, but we
  // only need it for the initial seed + the reseed-on-project-change
  // effect below, so we memoize on project identity.
  const migratedProject = useMemo(() => migrateProjectGates(project), [project]);

  // Local working copy of metric values. Seed with whatever is on the project,
  // falling back to defaults for any items that weren't saved yet.
  const [metrics, setMetrics] = useState<Record<string, number>>(() => ({
    ...defaultMetricValues(),
    ...(project.metrics || {})
  }));
  const [notes, setNotes] = useState<Record<string, string>>(() => ({
    ...(project.notes || {})
  }));
  const [startDate, setStartDate] = useState<string>(project.startDate || '');
  const [endDate, setEndDate] = useState<string>(project.endDate || '');
  const [infoStatus, setInfoStatus] = useState<InfoStatus>(project.infoStatus || 'TBD');
  const [generalInfo, setGeneralInfo] = useState<string>(project.generalInfo || '');
  const [currentGate, setCurrentGate] = useState<ProductGate | ''>(
    migratedProject.currentGate || ''
  );
  const [gateTargets, setGateTargets] = useState<Partial<Record<ProductGate, string>>>(
    migratedProject.gateTargets || {}
  );
  const [attachments, setAttachments] = useState<ProjectAttachment[]>(project.attachments || []);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [scoreHistory, setScoreHistory] = useState<ScoreSnapshot[]>(
    migratedProject.scoreHistory || []
  );
  const [deliverables, setDeliverables] = useState<Record<string, SubItemDeliverables>>(
    migratedProject.deliverables || {}
  );
  const [disabledItemIds, setDisabledItemIds] = useState<string[]>(
    project.disabledItemIds || []
  );
  const [customSubItems, setCustomSubItems] = useState<CustomSubItem[]>(
    project.customSubItems || []
  );
  const [scopeEditorOpen, setScopeEditorOpen] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(project.aiAnalysis || null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeConfirm, setCloseConfirm] = useState<'completed' | 'cancelled' | null>(null);
  const [downloadingSummary, setDownloadingSummary] = useState(false);

  // Which parent parameter bucket is currently visible.
  const [activeGroupId, setActiveGroupId] = useState<string>(RAMP_GROUPS[0].id);

  // Reseed when the user navigates into a different project. Legacy gate
  // values on the incoming project are migrated before seeding so the UI
  // never sees 'Post-PRR' in state.
  useEffect(() => {
    const mp = migrateProjectGates(project);
    setProjectName(project.name);
    setProductType(project.productType || '');
    setProjectStandards(project.standards || []);
    setMetrics({ ...defaultMetricValues(), ...(project.metrics || {}) });
    setNotes({ ...(project.notes || {}) });
    setStartDate(project.startDate || '');
    setEndDate(project.endDate || '');
    setInfoStatus(project.infoStatus || 'TBD');
    setGeneralInfo(project.generalInfo || '');
    setCurrentGate(mp.currentGate || '');
    setGateTargets(mp.gateTargets || {});
    setAttachments(project.attachments || []);
    setAttachmentError(null);
    setScoreHistory(mp.scoreHistory || []);
    setDeliverables(mp.deliverables || {});
    setDisabledItemIds(project.disabledItemIds || []);
    setCustomSubItems(project.customSubItems || []);
    setScopeEditorOpen(false);
    setAiAnalysis(project.aiAnalysis || null);
    setSavedAt(null);
    setError(null);
    setActiveGroupId(RAMP_GROUPS[0].id);
  }, [project.id]);

  const overall = useMemo(
    () => scoreForProject(metrics, disabledItemIds),
    [metrics, disabledItemIds]
  );
  const enabledCount = useMemo(
    () => enabledCountForProject(disabledItemIds),
    [disabledItemIds]
  );

  // Auto-sync bar-kind metrics to their deliverable completion percentage.
  // Whenever the user toggles, adds, removes, hides, or waives a deliverable,
  // every bar-kind sub-parameter that owns deliverables gets its stored
  // metric value re-derived as (done + waived) / total. This keeps the
  // group rollups and overall project score consistent with what the user
  // sees in the bar, without them needing to drag anything.
  //
  // Guarded with a structural diff so the effect is a no-op when nothing
  // actually changed — avoids an infinite loop with setMetrics.
  useEffect(() => {
    setMetrics((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const g of RAMP_GROUPS) {
        for (const item of g.items) {
          if (item.kind !== 'bar') continue;
          const pct = deliverablePctForItem(item, deliverables[item.id]);
          if (pct === null) continue;
          if (next[item.id] !== pct) {
            next[item.id] = pct;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [deliverables]);

  // Gate-readiness rollup. For each gate, count deliverables across the
  // whole project whose `dueBy` lands on that gate, AND how many are
  // satisfied (checked OR formally waived). Only counts deliverables in:
  //   - non-disabled sub-items (out-of-scope items don't block gate readiness)
  //   - non-hidden templates (user-removed items are "not required")
  //   - custom items that have a `dueBy` set
  // Hidden items and items without a gate are intentionally excluded.
  //
  // `waived` is reported separately from `done` so the UI can surface a small
  // amber dot on gate pills ("N of the closed items are waivers, not
  // completions") — useful visibility without penalizing readiness.
  const gateReadiness = useMemo(() => {
    const disabledSet = new Set(disabledItemIds);
    const empty: Record<
      ProductGate,
      { required: number; done: number; waived: number }
    > = {
      'CR':       { required: 0, done: 0, waived: 0 },
      'PDR':      { required: 0, done: 0, waived: 0 },
      'CDR':      { required: 0, done: 0, waived: 0 },
      'TRR':      { required: 0, done: 0, waived: 0 },
      'PRR':      { required: 0, done: 0, waived: 0 },
      'MP':       { required: 0, done: 0, waived: 0 }
    };
    RAMP_GROUPS.forEach((group) => {
      group.items.forEach((item) => {
        if (disabledSet.has(item.id)) return;
        const state = deliverables[item.id] || { checkedIds: [], custom: [] };
        const hiddenSet = new Set(state.hiddenTemplateIds || []);
        const checkedSet = new Set(state.checkedIds);
        const waivedSet = new Set(state.waivedTemplateIds || []);
        (item.deliverables || []).forEach((t) => {
          if (!t.dueBy) return;
          if (hiddenSet.has(t.id)) return;
          empty[t.dueBy].required += 1;
          if (waivedSet.has(t.id)) {
            empty[t.dueBy].done += 1;
            empty[t.dueBy].waived += 1;
          } else if (checkedSet.has(t.id)) {
            empty[t.dueBy].done += 1;
          }
        });
        (state.custom || []).forEach((c) => {
          if (!c.dueBy) return;
          empty[c.dueBy].required += 1;
          if (c.waived) {
            empty[c.dueBy].done += 1;
            empty[c.dueBy].waived += 1;
          } else if (c.done) {
            empty[c.dueBy].done += 1;
          }
        });
      });
    });
    return empty;
  }, [deliverables, disabledItemIds]);

  const setMetric = (id: string, value: number) => {
    setMetrics((prev) => ({ ...prev, [id]: value }));
  };

  const setNote = (id: string, value: string) => {
    const clipped = value.length > NOTE_MAX ? value.slice(0, NOTE_MAX) : value;
    setNotes((prev) => ({ ...prev, [id]: clipped }));
  };

  const setGateTarget = (gate: ProductGate, date: string) => {
    setGateTargets((prev) => {
      const next = { ...prev };
      if (date) next[gate] = date;
      else delete next[gate];
      return next;
    });
  };

  // --- Deliverables helpers ------------------------------------------------
  //
  // Deliverables are a per-sub-item checklist. The master list comes from
  // rampGroups.ts (immutable template). State here tracks which master ids
  // have been checked, plus any custom user-added items (each with its own
  // done flag). Changing deliverables does NOT alter the score — the slider
  // remains the source of truth.

  const getSubState = (subId: string): SubItemDeliverables =>
    deliverables[subId] || { checkedIds: [], custom: [] };

  const updateSubState = (subId: string, patch: Partial<SubItemDeliverables>) => {
    setDeliverables((prev) => {
      const current = prev[subId] || { checkedIds: [], custom: [] };
      const next: SubItemDeliverables = { ...current, ...patch };
      return { ...prev, [subId]: next };
    });
  };

  const toggleDeliverable = (subId: string, templateId: string) => {
    if (readOnly) return;
    const state = getSubState(subId);
    const has = state.checkedIds.includes(templateId);
    updateSubState(subId, {
      checkedIds: has
        ? state.checkedIds.filter((id) => id !== templateId)
        : [...state.checkedIds, templateId]
    });
  };

  const addCustomDeliverable = (
    subId: string,
    title: string,
    dueBy?: ProductGate
  ) => {
    if (readOnly) return;
    const trimmed = title.trim().slice(0, 120);
    if (!trimmed) return;
    const state = getSubState(subId);
    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const next: CustomDeliverable = { id, title: trimmed, done: false };
    if (dueBy) next.dueBy = dueBy;
    updateSubState(subId, {
      custom: [...(state.custom || []), next]
    });
  };

  const setCustomDeliverableDueBy = (
    subId: string,
    customId: string,
    dueBy: ProductGate | undefined
  ) => {
    if (readOnly) return;
    const state = getSubState(subId);
    updateSubState(subId, {
      custom: (state.custom || []).map((c) => {
        if (c.id !== customId) return c;
        // Omit the field entirely when dueBy is undefined — Firestore rejects
        // `undefined` values on updateDoc(), so we must never persist them.
        const { dueBy: _drop, ...rest } = c;
        return dueBy ? { ...rest, dueBy } : rest;
      })
    });
  };

  const toggleCustomDeliverable = (subId: string, customId: string) => {
    if (readOnly) return;
    const state = getSubState(subId);
    updateSubState(subId, {
      custom: (state.custom || []).map((c) =>
        c.id === customId ? { ...c, done: !c.done } : c
      )
    });
  };

  const removeCustomDeliverable = (subId: string, customId: string) => {
    if (readOnly) return;
    const state = getSubState(subId);
    updateSubState(subId, {
      custom: (state.custom || []).filter((c) => c.id !== customId)
    });
  };

  // Hide a curated template deliverable from this project's view. Purely
  // additive to state — the template itself is never mutated, and the hide
  // is reversible via `unhideTemplateDeliverable`. Also unchecks the item
  // if it was checked, so "done %" doesn't mislead once the user is saying
  // "not required".
  const hideTemplateDeliverable = (subId: string, templateId: string) => {
    if (readOnly) return;
    const state = getSubState(subId);
    if ((state.hiddenTemplateIds || []).includes(templateId)) return;
    updateSubState(subId, {
      hiddenTemplateIds: [...(state.hiddenTemplateIds || []), templateId],
      checkedIds: state.checkedIds.filter((id) => id !== templateId)
    });
  };

  const unhideTemplateDeliverable = (subId: string, templateId: string) => {
    if (readOnly) return;
    const state = getSubState(subId);
    updateSubState(subId, {
      hiddenTemplateIds: (state.hiddenTemplateIds || []).filter((id) => id !== templateId)
    });
  };

  // --- Waiver / deviation helpers -----------------------------------------
  //
  // A waived deliverable is formally accepted as "we're not going to do this
  // and we're willing to ship with that known deviation" (ISO 9001 §8.7).
  // Waiving is:
  //   - reversible (unwaive to restore the original un-satisfied state)
  //   - mutually exclusive with "hidden" (hide first removes any waiver)
  //   - treated as satisfied for gate readiness, tracked separately as `waived`
  // Reason is optional in the UI — the pattern is "waive fast, annotate later".

  const WAIVER_REASON_MAX = 240;

  const waiveTemplateDeliverable = (
    subId: string,
    templateId: string,
    reason?: string
  ) => {
    if (readOnly) return;
    const state = getSubState(subId);
    if ((state.waivedTemplateIds || []).includes(templateId)) {
      // Already waived — just update the reason if one is provided.
      if (reason !== undefined) {
        const trimmed = reason.trim().slice(0, WAIVER_REASON_MAX);
        const nextReasons = { ...(state.waiverReasons || {}) };
        if (trimmed) nextReasons[templateId] = trimmed;
        else delete nextReasons[templateId];
        updateSubState(subId, { waiverReasons: nextReasons });
      }
      return;
    }
    const trimmed = (reason || '').trim().slice(0, WAIVER_REASON_MAX);
    const nextReasons = { ...(state.waiverReasons || {}) };
    if (trimmed) nextReasons[templateId] = trimmed;
    const nextWaivedAt = { ...(state.waivedAt || {}) };
    nextWaivedAt[templateId] = Date.now();
    updateSubState(subId, {
      waivedTemplateIds: [...(state.waivedTemplateIds || []), templateId],
      // Waiving a checked item un-checks it — the credit now comes from the
      // waiver, not the check. Prevents double-counting on the UI.
      checkedIds: state.checkedIds.filter((id) => id !== templateId),
      waiverReasons: nextReasons,
      waivedAt: nextWaivedAt
    });
  };

  const unwaiveTemplateDeliverable = (subId: string, templateId: string) => {
    if (readOnly) return;
    const state = getSubState(subId);
    const nextReasons = { ...(state.waiverReasons || {}) };
    delete nextReasons[templateId];
    const nextWaivedAt = { ...(state.waivedAt || {}) };
    delete nextWaivedAt[templateId];
    updateSubState(subId, {
      waivedTemplateIds: (state.waivedTemplateIds || []).filter((id) => id !== templateId),
      waiverReasons: nextReasons,
      waivedAt: nextWaivedAt
    });
  };

  const setTemplateWaiverReason = (
    subId: string,
    templateId: string,
    reason: string
  ) => {
    if (readOnly) return;
    const state = getSubState(subId);
    const trimmed = reason.trim().slice(0, WAIVER_REASON_MAX);
    const nextReasons = { ...(state.waiverReasons || {}) };
    if (trimmed) nextReasons[templateId] = trimmed;
    else delete nextReasons[templateId];
    updateSubState(subId, { waiverReasons: nextReasons });
  };

  const waiveCustomDeliverable = (
    subId: string,
    customId: string,
    reason?: string
  ) => {
    if (readOnly) return;
    const state = getSubState(subId);
    const trimmed = (reason || '').trim().slice(0, WAIVER_REASON_MAX);
    updateSubState(subId, {
      custom: (state.custom || []).map((c) => {
        if (c.id !== customId) return c;
        const next: CustomDeliverable = {
          ...c,
          waived: true,
          // Waiving un-dones the item so the UI doesn't double-count it.
          done: false,
          waivedAt: Date.now()
        };
        if (trimmed) next.waiverReason = trimmed;
        else delete next.waiverReason;
        return next;
      })
    });
  };

  const unwaiveCustomDeliverable = (subId: string, customId: string) => {
    if (readOnly) return;
    const state = getSubState(subId);
    updateSubState(subId, {
      custom: (state.custom || []).map((c) => {
        if (c.id !== customId) return c;
        // Drop waived/waiverReason/waivedAt entirely — Firestore doesn't
        // tolerate undefined, so explicit deletion is safer than setting
        // false/null.
        const { waived: _w, waiverReason: _wr, waivedAt: _wa, ...rest } = c;
        return rest;
      })
    });
  };

  const setCustomWaiverReason = (
    subId: string,
    customId: string,
    reason: string
  ) => {
    if (readOnly) return;
    const state = getSubState(subId);
    const trimmed = reason.trim().slice(0, WAIVER_REASON_MAX);
    updateSubState(subId, {
      custom: (state.custom || []).map((c) => {
        if (c.id !== customId) return c;
        const next = { ...c };
        if (trimmed) next.waiverReason = trimmed;
        else delete next.waiverReason;
        return next;
      })
    });
  };

  // --- Custom sub-parameter helpers ----------------------------------------
  //
  // Users can add project-local sub-parameters to any of the 4 RAMP_GROUPS.
  // Phase 1: these are informational ONLY — they render like a `bar` metric
  // but do NOT participate in scoreForGroup / scoreForProject. Kept on
  // `customSubItems` (never mixed into the `metrics` map) so the scoring
  // math can't accidentally pick them up.

  const CUSTOM_SUB_TITLE_MAX = 80;

  const addCustomSubItem = (groupId: string, title: string) => {
    if (readOnly) return;
    const trimmed = title.trim().slice(0, CUSTOM_SUB_TITLE_MAX);
    if (!trimmed) return;
    const id = `csub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setCustomSubItems((prev) => [
      ...prev,
      { id, groupId, title: trimmed, value: 0 }
    ]);
  };

  const setCustomSubItemValue = (id: string, value: number) => {
    if (readOnly) return;
    setCustomSubItems((prev) =>
      prev.map((c) => (c.id === id ? { ...c, value } : c))
    );
  };

  const setCustomSubItemNote = (id: string, note: string) => {
    if (readOnly) return;
    const clipped = note.length > NOTE_MAX ? note.slice(0, NOTE_MAX) : note;
    setCustomSubItems((prev) =>
      prev.map((c) => (c.id === id ? { ...c, note: clipped } : c))
    );
  };

  const renameCustomSubItem = (id: string, title: string) => {
    if (readOnly) return;
    const trimmed = title.trim().slice(0, CUSTOM_SUB_TITLE_MAX);
    if (!trimmed) return;
    setCustomSubItems((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c))
    );
  };

  const removeCustomSubItem = (id: string) => {
    if (readOnly) return;
    setCustomSubItems((prev) => prev.filter((c) => c.id !== id));
  };

  // --- Scope helpers -------------------------------------------------------
  //
  // A sub-item is "disabled" (out of scope) if its id is in `disabledItemIds`.
  // Disabled items don't contribute to the rollup score and render as greyed
  // N/A rows in the deep-dive.

  const isItemDisabled = (id: string) => disabledItemIds.indexOf(id) >= 0;

  const enableItem = (id: string) => {
    if (readOnly) return;
    setDisabledItemIds((prev) => prev.filter((x) => x !== id));
  };

  const disableItem = (id: string) => {
    if (readOnly) return;
    setDisabledItemIds((prev) => (prev.indexOf(id) >= 0 ? prev : [...prev, id]));
  };

  const applyScope = (nextDisabled: string[]) => {
    if (readOnly) return;
    setDisabledItemIds(nextDisabled);
  };

  // --- Attachment links ----------------------------------------------------
  //
  // To avoid Firebase Storage billing while we're still in private beta, we
  // don't host files — users paste a URL (Google Drive / Dropbox / OneDrive /
  // email / etc.) and we just store the link.

  const normalizeUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('mailto:')) {
      return trimmed;
    }
    return `https://${trimmed}`;
  };

  const isValidUrl = (raw: string): boolean => {
    try {
      const u = new URL(normalizeUrl(raw));
      return !!u.host || u.protocol === 'mailto:';
    } catch {
      return false;
    }
  };

  const addAttachment = async (name: string, url: string) => {
    if (readOnly) return;
    if (!auth.currentUser) {
      setAttachmentError('You must be signed in to add links.');
      return;
    }
    const cleanedName = (name || '').trim().slice(0, ATTACHMENT_NAME_MAX);
    const cleanedUrl = normalizeUrl(url);
    if (!cleanedUrl || !isValidUrl(cleanedUrl)) {
      setAttachmentError('That doesn\'t look like a valid URL.');
      return;
    }
    setAttachmentError(null);
    const next: ProjectAttachment[] = [
      ...attachments,
      {
        name: cleanedName || cleanedUrl,
        url: cleanedUrl,
        addedAt: Date.now()
      }
    ];
    setAttachments(next);
    try {
      await updateDoc(doc(db, 'projects', project.id), {
        attachments: next,
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      console.error('Attachment save failed:', err);
      setAttachmentError(err?.message || 'Failed to save link.');
    }
  };

  // --- Standards -----------------------------------------------------------
  // Optimistic: flip the UI immediately so the Coacher panel and AI Analysis
  // panel see the new selection on the next render, then persist. If the
  // write fails we surface the error but keep the in-memory state — the user
  // can retry by toggling another standard.
  const saveStandards = async (next: string[]) => {
    if (readOnly) return;
    setProjectStandards(next);
    try {
      await updateDoc(doc(db, 'projects', project.id), {
        standards: next,
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      console.error('Standards save failed:', err);
      setError(err?.message || 'Could not save standards.');
    }
  };

  // --- AI Analysis ---------------------------------------------------------

  const persistAiAnalysis = async (result: AIAnalysis) => {
    setAiAnalysis(result);
    if (readOnly) return;
    try {
      await updateDoc(doc(db, 'projects', project.id), {
        aiAnalysis: result,
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      console.error('AI analysis save failed:', err);
      // Non-blocking — user still sees the result in memory.
    }
  };

  const removeAttachment = async (att: ProjectAttachment) => {
    if (readOnly) return;
    setAttachmentError(null);
    const next = attachments.filter(
      (a) => !(a.url === att.url && a.addedAt === att.addedAt)
    );
    setAttachments(next);
    try {
      await updateDoc(doc(db, 'projects', project.id), {
        attachments: next,
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      console.error('Attachment delete failed:', err);
      setAttachmentError(err?.message || 'Failed to remove link.');
    }
  };

  // Build the next scoreHistory array from the current in-memory state.
  // Appends a new snapshot only if overall or any group score changed vs.
  // the most recent entry. Caps the history at SCORE_HISTORY_LIMIT entries.
  const buildNextHistory = (): ScoreSnapshot[] => {
    const groupScores: Record<string, number> = {};
    RAMP_GROUPS.forEach((g) => {
      groupScores[g.id] = scoreForGroup(g, metrics, disabledItemIds);
    });
    const snapshot: ScoreSnapshot = {
      ts: Date.now(),
      overall,
      groups: groupScores,
      // Only include currentGate if it is actually set — undefined values break
      // Firestore serialization. Prefer omitting the key over writing undefined.
      ...(currentGate ? { currentGate } : {})
    };
    const last = scoreHistory[scoreHistory.length - 1];
    const unchanged =
      last &&
      last.overall === snapshot.overall &&
      last.currentGate === snapshot.currentGate &&
      RAMP_GROUPS.every((g) => (last.groups[g.id] ?? -1) === snapshot.groups[g.id]);
    if (unchanged) return scoreHistory;
    const next = [...scoreHistory, snapshot];
    // Trim oldest entries if we exceed the cap.
    return next.length > SCORE_HISTORY_LIMIT
      ? next.slice(next.length - SCORE_HISTORY_LIMIT)
      : next;
  };

  const handleSave = async () => {
    if (readOnly) return;
    if (!auth.currentUser) {
      setError('You must be signed in to save changes.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const nextHistory = buildNextHistory();
      const payload = stripUndefined({
        name: projectName.trim() || project.name,
        productType: productType.trim() || 'Hardware',
        metrics,
        notes,
        lastScore: overall,
        startDate,
        endDate,
        infoStatus,
        generalInfo,
        currentGate: currentGate || null,
        gateTargets,
        attachments,
        scoreHistory: nextHistory,
        deliverables,
        disabledItemIds,
        customSubItems,
        updatedAt: serverTimestamp()
      });
      // Belt-and-suspenders: if anything undefined survived stripping,
      // surface exactly where it is instead of Firestore's generic error.
      const badPath = findUndefinedPath(payload);
      if (badPath) {
        console.error('Save payload still contains undefined at:', badPath, payload);
        throw new Error(`Internal state error: "${badPath}" is undefined. Please reload and retry.`);
      }
      await updateDoc(doc(db, 'projects', project.id), payload);
      setScoreHistory(nextHistory);
      setSavedAt(Date.now());
    } catch (err: any) {
      console.error('Save project failed:', err);
      setError(err?.message || 'Save failed — please retry.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async (reason: 'completed' | 'cancelled') => {
    if (readOnly) return;
    if (!auth.currentUser) {
      setError('You must be signed in to close a project.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const nextHistory = buildNextHistory();
      const payload = stripUndefined({
        status: 'archived',
        closeReason: reason,
        closedAt: serverTimestamp(),
        name: projectName.trim() || project.name,
        productType: productType.trim() || 'Hardware',
        metrics,
        notes,
        lastScore: overall,
        startDate,
        endDate,
        infoStatus,
        generalInfo,
        currentGate: currentGate || null,
        gateTargets,
        attachments,
        scoreHistory: nextHistory,
        deliverables,
        disabledItemIds,
        customSubItems,
        updatedAt: serverTimestamp()
      });
      const badPath = findUndefinedPath(payload);
      if (badPath) {
        console.error('Close payload still contains undefined at:', badPath, payload);
        throw new Error(`Internal state error: "${badPath}" is undefined. Please reload and retry.`);
      }
      await updateDoc(doc(db, 'projects', project.id), payload);
      setCloseConfirm(null);
      onBack();
    } catch (err: any) {
      console.error('Close project failed:', err);
      setError(err?.message || 'Close failed — please retry.');
      setSaving(false);
    }
  };

  // Build an editable .pptx executive summary from the project's current
  // in-memory state + most recent AI analysis (if any).
  const handleDownloadSummary = async () => {
    if (downloadingSummary) return;
    setDownloadingSummary(true);
    setError(null);
    try {
      const snapshot: DeepDiveProject = {
        ...project,
        name: projectName.trim() || project.name,
        productType: productType.trim() || project.productType,
        metrics,
        notes,
        startDate,
        endDate,
        infoStatus,
        generalInfo,
        currentGate: currentGate || undefined,
        gateTargets,
        attachments,
        deliverables,
        disabledItemIds,
        customSubItems,
        aiAnalysis: aiAnalysis || undefined
      };
      await generateExecutiveSummary(snapshot, aiAnalysis, overall);
    } catch (err: any) {
      console.error('Executive summary export failed:', err);
      setError(err?.message || 'Could not generate summary.');
    } finally {
      setDownloadingSummary(false);
    }
  };

  const band = scoreBand(overall);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-left">
      {/* Breadcrumb / back */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-blue-600 transition-colors mb-6"
      >
        <ArrowLeft size={14} /> Back to Projects
      </button>

      {/* Header card */}
      <div className="bg-slate-900 text-white rounded-sm shadow-2xl relative overflow-hidden mb-10">
        <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
        <div className="relative z-10 p-8 md:p-10 grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-8">
            <p className="text-blue-400 font-black uppercase tracking-[0.3em] text-[10px] mb-3">
              {readOnly ? 'Archived Project' : 'Active Project Workspace'}
            </p>
            <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none mb-3">
              {projectName || project.name}
            </h2>
            <div className="flex flex-wrap gap-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
              {productType && (
                <span className="bg-white/10 px-3 py-1">{productType}</span>
              )}
              <span className={`px-3 py-1 ${band.bg} text-white`}>
                {band.label}
              </span>
              {project.closeReason && (
                <span className={`px-3 py-1 ${project.closeReason === 'cancelled' ? 'bg-red-600' : 'bg-emerald-600'} text-white`}>
                  {project.closeReason === 'cancelled' ? 'Cancelled' : 'Completed'}
                </span>
              )}
            </div>
          </div>
          <div className="md:col-span-4 flex md:justify-end">
            <div className="text-center md:text-right">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-1">
                Overall Readiness
              </p>
              <div className="text-6xl md:text-7xl font-black tracking-tighter">
                <motion.span
                  key={overall}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {overall}
                </motion.span>
                <span className="text-3xl align-top ml-1">%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save bar (only when editable) */}
      {!readOnly && (
        <div className="sticky top-20 z-30 bg-white/95 backdrop-blur border border-slate-200 rounded-sm shadow-lg p-4 mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <TrendingUp size={14} className={band.text} />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">
              Live Rollup — {band.label} · <span className={band.text}>{overall}%</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            {savedAt && !saving && (
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 flex items-center gap-1">
                <CheckCircle2 size={12} /> Saved
              </span>
            )}
            {error && (
              <span className="text-[10px] font-black uppercase tracking-widest text-red-600 flex items-center gap-1">
                <AlertTriangle size={12} /> {error}
              </span>
            )}
            <button
              onClick={handleDownloadSummary}
              disabled={saving || downloadingSummary}
              title={aiAnalysis ? 'Download editable .pptx executive summary (4 slides)' : 'Download summary — run AI Analysis first for full 4-slide deck'}
              className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-blue-600 transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              {downloadingSummary ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Download size={12} />
              )}
              Download Summary
            </button>
            <button
              onClick={() => setCloseConfirm('cancelled')}
              disabled={saving}
              className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-red-600 transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              <XCircle size={12} /> Cancel Project
            </button>
            <button
              onClick={() => setCloseConfirm('completed')}
              disabled={saving}
              className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-emerald-600 transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              <Archive size={12} /> Mark Completed
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save
            </button>
          </div>
        </div>
      )}

      {/* Gate-readiness strip — six pills, one per stage gate, showing
          % of deliverables due-by that gate which are checked. The currently
          active gate (from General Info) is highlighted. */}
      <GateReadinessStrip
        readiness={gateReadiness}
        currentGate={currentGate || null}
      />

      {/* Tab strip — general-info + 4 parameter buckets + AI analysis + history */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {/* General Info tab — always first */}
        {(() => {
          const isActive = activeGroupId === GENERAL_INFO_TAB_ID;
          return (
            <button
              key={GENERAL_INFO_TAB_ID}
              type="button"
              onClick={() => setActiveGroupId(GENERAL_INFO_TAB_ID)}
              aria-pressed={isActive}
              className={`relative text-left px-4 py-4 border transition-all overflow-hidden ${
                isActive
                  ? 'bg-slate-900 text-white border-transparent shadow-xl'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:shadow'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <ClipboardList
                  size={14}
                  className={isActive ? 'text-white' : 'text-slate-500'}
                />
                <h4
                  className={`text-[11px] font-black uppercase tracking-tight leading-tight truncate ${
                    isActive ? 'text-white' : 'text-slate-800'
                  }`}
                >
                  General Info
                </h4>
              </div>
              {isActive && (
                <motion.span
                  layoutId="deepdive-tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/80"
                />
              )}
            </button>
          );
        })()}

        {RAMP_GROUPS.map((group) => {
          const groupAllDisabled = group.items.every((i) => isItemDisabled(i.id));
          const groupScore = scoreForGroup(group, metrics, disabledItemIds);
          const tokens = accentTokens[group.accent];
          const isActive = group.id === activeGroupId;
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => setActiveGroupId(group.id)}
              aria-pressed={isActive}
              className={`relative text-left px-4 py-4 border transition-all overflow-hidden ${
                isActive
                  ? `${tokens.bg} text-white border-transparent shadow-xl`
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:shadow'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h4
                  className={`text-[11px] font-black uppercase tracking-tight leading-tight truncate ${
                    isActive ? 'text-white' : 'text-slate-800'
                  }`}
                >
                  {group.title}
                </h4>
                <span
                  className={`text-base font-black tracking-tighter flex-shrink-0 ${
                    isActive
                      ? 'text-white'
                      : groupAllDisabled
                        ? 'text-slate-400'
                        : tokens.text
                  }`}
                >
                  {groupAllDisabled ? 'N/A' : `${groupScore}%`}
                </span>
              </div>
              {isActive && (
                <motion.span
                  layoutId="deepdive-tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/80"
                />
              )}
            </button>
          );
        })}

        {/* AI Analysis tab — secondary/utility style (analysis tool, not a score bucket) */}
        {(() => {
          const isActive = activeGroupId === AI_ANALYSIS_TAB_ID;
          return (
            <button
              key={AI_ANALYSIS_TAB_ID}
              type="button"
              onClick={() => setActiveGroupId(AI_ANALYSIS_TAB_ID)}
              aria-pressed={isActive}
              className={`relative text-left px-4 py-4 border-2 transition-all overflow-hidden ${
                isActive
                  ? 'bg-gradient-to-r from-slate-900 to-blue-950 text-white border-transparent shadow-xl'
                  : 'bg-transparent text-slate-500 border-dashed border-slate-300 hover:bg-white hover:text-slate-700 hover:border-slate-400'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles
                  size={14}
                  className={isActive ? 'text-blue-300' : 'text-blue-400'}
                />
                <h4
                  className={`text-[11px] font-black uppercase tracking-tight leading-tight truncate ${
                    isActive ? 'text-white' : 'text-slate-600'
                  }`}
                >
                  AI Analysis
                </h4>
              </div>
              {isActive && (
                <motion.span
                  layoutId="deepdive-tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/80"
                />
              )}
            </button>
          );
        })()}

        {/* History tab — secondary/utility style (derived view, not a score bucket) */}
        {(() => {
          const isActive = activeGroupId === HISTORY_TAB_ID;
          return (
            <button
              key={HISTORY_TAB_ID}
              type="button"
              onClick={() => setActiveGroupId(HISTORY_TAB_ID)}
              aria-pressed={isActive}
              className={`relative text-left px-4 py-4 border-2 transition-all overflow-hidden ${
                isActive
                  ? 'bg-slate-900 text-white border-transparent shadow-xl'
                  : 'bg-transparent text-slate-500 border-dashed border-slate-300 hover:bg-white hover:text-slate-700 hover:border-slate-400'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <LineChartIcon
                  size={14}
                  className={isActive ? 'text-white' : 'text-slate-400'}
                />
                <h4
                  className={`text-[11px] font-black uppercase tracking-tight leading-tight truncate ${
                    isActive ? 'text-white' : 'text-slate-600'
                  }`}
                >
                  History
                </h4>
                {scoreHistory.length > 0 && (
                  <span
                    className={`ml-auto text-[10px] font-black tabular-nums ${
                      isActive ? 'text-white/80' : 'text-slate-400'
                    }`}
                  >
                    {scoreHistory.length}
                  </span>
                )}
              </div>
              {isActive && (
                <motion.span
                  layoutId="deepdive-tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/80"
                />
              )}
            </button>
          );
        })()}
      </div>

      <AnimatePresence mode="wait">
        {activeGroupId === AI_ANALYSIS_TAB_ID ? (
          <motion.div
            key={AI_ANALYSIS_TAB_ID}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <AIAnalysisPanel
              projectInput={{
                name: project.name,
                productType: project.productType,
                // Pass the current picks so ai-analyze weighs risk against
                // them; empty array = no compliance-specific weighting.
                standards: projectStandards,
                metrics,
                notes,
                startDate,
                endDate,
                infoStatus,
                generalInfo,
                currentGate: currentGate || undefined,
                gateTargets,
                disabledItemIds,
                templateName: getTemplate(project.templateId).name
              }}
              cached={aiAnalysis}
              onAnalyzed={persistAiAnalysis}
              readOnly={readOnly}
            />
          </motion.div>
        ) : activeGroupId === HISTORY_TAB_ID ? (
          <motion.div
            key={HISTORY_TAB_ID}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <ScoreHistoryPanel
              history={scoreHistory}
              gateTargets={gateTargets}
              currentGate={currentGate}
            />
          </motion.div>
        ) : activeGroupId === GENERAL_INFO_TAB_ID ? (
          <motion.div
            key={GENERAL_INFO_TAB_ID}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <GeneralInfoPanel
              projectName={projectName}
              productType={productType}
              standards={projectStandards}
              onChangeStandards={saveStandards}
              startDate={startDate}
              endDate={endDate}
              infoStatus={infoStatus}
              generalInfo={generalInfo}
              currentGate={currentGate}
              gateTargets={gateTargets}
              attachments={attachments}
              attachmentError={attachmentError}
              templateId={project.templateId}
              enabledCount={enabledCount}
              totalCount={TOTAL_ITEM_COUNT}
              onEditScope={() => setScopeEditorOpen(true)}
              onChangeProjectName={setProjectName}
              onChangeProductType={setProductType}
              onChangeStartDate={setStartDate}
              onChangeEndDate={setEndDate}
              onChangeStatus={setInfoStatus}
              onChangeGeneralInfo={(v) =>
                setGeneralInfo(v.length > GENERAL_INFO_MAX ? v.slice(0, GENERAL_INFO_MAX) : v)
              }
              onChangeCurrentGate={setCurrentGate}
              onChangeGateTarget={setGateTarget}
              onAddAttachment={addAttachment}
              onRemoveAttachment={removeAttachment}
              readOnly={readOnly}
            />
          </motion.div>
        ) : (
          (() => {
            const group = RAMP_GROUPS.find((g) => g.id === activeGroupId) ?? RAMP_GROUPS[0];
            const groupAllDisabled = group.items.every((i) => isItemDisabled(i.id));
            const groupScore = scoreForGroup(group, metrics, disabledItemIds);
            const gBand = scoreBand(groupScore);
            const tokens = accentTokens[group.accent];

            return (
              <motion.div
                key={group.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="bg-white border border-slate-200 rounded-sm shadow-xl overflow-hidden"
              >
                {/* Group header */}
                <div className={`${tokens.bg} text-white px-6 py-5 flex items-center justify-between`}>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/70 mb-1">
                      Parent Parameter
                    </p>
                    <h3 className="text-lg font-black uppercase tracking-tight leading-tight">
                      {group.title}
                    </h3>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-black tracking-tighter leading-none">
                      {groupAllDisabled ? 'N/A' : `${groupScore}%`}
                    </div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-white/70 mt-1">
                      {groupAllDisabled ? 'Out of scope' : gBand.label}
                    </p>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  <p className="text-[12px] font-medium text-slate-500 leading-relaxed -mt-1">
                    {group.subtitle}
                  </p>

                  {group.items.map((item) =>
                    isItemDisabled(item.id) ? (
                      <DisabledMetricRow
                        key={item.id}
                        item={item}
                        onEnable={() => enableItem(item.id)}
                        readOnly={readOnly}
                      />
                    ) : (
                      <MetricRow
                        key={item.id}
                        item={item}
                        value={metrics[item.id] ?? item.defaultValue}
                        onChange={(v) => setMetric(item.id, v)}
                        note={notes[item.id] ?? ''}
                        onChangeNote={(v) => setNote(item.id, v)}
                        deliverables={getSubState(item.id)}
                        onToggleTemplate={(tid) => toggleDeliverable(item.id, tid)}
                        onAddCustom={(title, dueBy) => addCustomDeliverable(item.id, title, dueBy)}
                        onToggleCustom={(cid) => toggleCustomDeliverable(item.id, cid)}
                        onRemoveCustom={(cid) => removeCustomDeliverable(item.id, cid)}
                        onHideTemplate={(tid) => hideTemplateDeliverable(item.id, tid)}
                        onUnhideTemplate={(tid) => unhideTemplateDeliverable(item.id, tid)}
                        onSetCustomDueBy={(cid, dueBy) => setCustomDeliverableDueBy(item.id, cid, dueBy)}
                        onWaiveTemplate={(tid, reason) => waiveTemplateDeliverable(item.id, tid, reason)}
                        onUnwaiveTemplate={(tid) => unwaiveTemplateDeliverable(item.id, tid)}
                        onSetTemplateWaiverReason={(tid, reason) => setTemplateWaiverReason(item.id, tid, reason)}
                        onWaiveCustom={(cid, reason) => waiveCustomDeliverable(item.id, cid, reason)}
                        onUnwaiveCustom={(cid) => unwaiveCustomDeliverable(item.id, cid)}
                        onSetCustomWaiverReason={(cid, reason) => setCustomWaiverReason(item.id, cid, reason)}
                        onDisable={() => disableItem(item.id)}
                        readOnly={readOnly}
                        productType={productType}
                        groupTitle={group.title}
                        standards={projectStandards}
                      />
                    )
                  )}
                  {group.items.every((i) => isItemDisabled(i.id)) &&
                    customSubItems.filter((c) => c.groupId === group.id).length === 0 && (
                      <p className="text-[11px] font-medium text-slate-400 italic">
                        All metrics in this group are out of scope. Edit scope from General Info to add some.
                      </p>
                    )}

                  {/* Project-local custom sub-parameters for this group. Informational
                      only — they don't contribute to the group or overall score. */}
                  {customSubItems
                    .filter((c) => c.groupId === group.id)
                    .map((custom) => (
                      <CustomMetricRow
                        key={custom.id}
                        item={custom}
                        onChange={(v) => setCustomSubItemValue(custom.id, v)}
                        onChangeNote={(n) => setCustomSubItemNote(custom.id, n)}
                        onRename={(t) => renameCustomSubItem(custom.id, t)}
                        onRemove={() => removeCustomSubItem(custom.id)}
                        readOnly={readOnly}
                      />
                    ))}

                  {/* Add-custom affordance — visible at the bottom of every group.
                      Also flags that custom items are not scored, so users have
                      the right expectation before they add one. */}
                  {!readOnly && (
                    <div>
                      <AddCustomSubItem
                        groupId={group.id}
                        onAdd={(title) => addCustomSubItem(group.id, title)}
                        maxLength={CUSTOM_SUB_TITLE_MAX}
                      />
                      <p className="mt-2 flex items-start gap-1.5 text-[10px] font-medium text-slate-500 leading-snug">
                        <Info size={11} className="mt-0.5 flex-shrink-0 text-slate-400" />
                        <span>
                          Custom sub-parameters are project-specific and <strong className="font-black">do not contribute</strong> to the group score or the overall readiness rollup — they're for tracking only.
                        </span>
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })()
        )}
      </AnimatePresence>

      {/* Scope editor modal */}
      <ScopeEditor
        open={scopeEditorOpen}
        disabledItemIds={disabledItemIds}
        templateId={project.templateId}
        onCancel={() => setScopeEditorOpen(false)}
        onSave={(next) => {
          applyScope(next);
          setScopeEditorOpen(false);
        }}
      />

      {/* Close / cancel confirm modal */}
      <AnimatePresence>
        {closeConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md p-8 rounded-sm shadow-2xl space-y-5"
            >
              <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">
                {closeConfirm === 'completed' ? 'Mark Project Completed?' : 'Cancel Project?'}
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                {closeConfirm === 'completed'
                  ? 'This will move the project to the Archive tab. All current metrics and history will be preserved.'
                  : 'The project will be archived as cancelled. All data stays preserved — you can still view it in the Archive tab.'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setCloseConfirm(null)}
                  className="flex-1 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800 flex items-center justify-center gap-2"
                >
                  <Undo2 size={12} /> Keep Open
                </button>
                <button
                  onClick={() => handleClose(closeConfirm)}
                  disabled={saving}
                  className={`flex-1 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50 ${
                    closeConfirm === 'completed' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {saving && <Loader2 size={12} className="animate-spin inline mr-2" />}
                  {closeConfirm === 'completed' ? 'Mark Completed' : 'Cancel Project'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

// ---------------------------------------------------------------------------
// Compact "out of scope" row shown for sub-items that are disabled by the
// project's scope. Doesn't contribute to the rollup. Single click to re-enable.
// ---------------------------------------------------------------------------

const DisabledMetricRow: React.FC<{
  item: RampSubItem;
  onEnable: () => void;
  readOnly?: boolean;
}> = ({ item, onEnable, readOnly }) => {
  return (
    <div className="flex items-center justify-between gap-3 py-2 px-3 bg-slate-50 border border-dashed border-slate-200 rounded-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 bg-slate-200 text-slate-500 flex-shrink-0">
          N/A
        </span>
        <p className="text-[11px] font-medium text-slate-400 truncate">
          {item.title}
        </p>
      </div>
      {!readOnly && (
        <button
          type="button"
          onClick={onEnable}
          className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-blue-600 transition-colors flex-shrink-0"
        >
          Enable
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Per-item metric row. Renders either an animated progress slider (kind=bar)
// or a numeric input with a derived score chip (kind=value).
// ---------------------------------------------------------------------------

const MetricRow: React.FC<{
  item: RampSubItem;
  value: number;
  onChange: (v: number) => void;
  note: string;
  onChangeNote: (v: string) => void;
  deliverables: SubItemDeliverables;
  onToggleTemplate: (templateId: string) => void;
  onAddCustom: (title: string, dueBy?: ProductGate) => void;
  onToggleCustom: (customId: string) => void;
  onRemoveCustom: (customId: string) => void;
  onHideTemplate: (templateId: string) => void;
  onUnhideTemplate: (templateId: string) => void;
  onSetCustomDueBy: (customId: string, dueBy: ProductGate | undefined) => void;
  onWaiveTemplate: (templateId: string, reason?: string) => void;
  onUnwaiveTemplate: (templateId: string) => void;
  onSetTemplateWaiverReason: (templateId: string, reason: string) => void;
  onWaiveCustom: (customId: string, reason?: string) => void;
  onUnwaiveCustom: (customId: string) => void;
  onSetCustomWaiverReason: (customId: string, reason: string) => void;
  onDisable?: () => void;
  readOnly?: boolean;
  productType?: string;
  groupTitle?: string;
  standards?: string[];
}> = ({
  item,
  value,
  onChange,
  note,
  onChangeNote,
  deliverables,
  onToggleTemplate,
  onAddCustom,
  onToggleCustom,
  onRemoveCustom,
  onHideTemplate,
  onUnhideTemplate,
  onSetCustomDueBy,
  onWaiveTemplate,
  onUnwaiveTemplate,
  onSetTemplateWaiverReason,
  onWaiveCustom,
  onUnwaiveCustom,
  onSetCustomWaiverReason,
  onDisable,
  readOnly,
  productType,
  groupTitle,
  standards
}) => {
  // For bar-kind items with deliverables, derive the effective value from
  // deliverable completion right here so the score chip and band color stay
  // in lockstep with the bar — no one-frame lag while the parent useEffect
  // flushes the metrics map.
  const barCounts =
    item.kind === 'bar' ? deliverableCountsForItem(item, deliverables) : null;
  const autoBarMode = !!barCounts && barCounts.total > 0;
  const effectiveValue = autoBarMode
    ? Math.round((barCounts!.done / barCounts!.total) * 100)
    : value;
  const score = scoreForItem(item, effectiveValue);
  const band = scoreBand(score);
  const tooltipText = `${item.tool ? item.tool + ' · ' : ''}${item.question}`;

  // --- Coacher state -------------------------------------------------------
  // Lazy-loaded the first time the user opens the panel for this sub-item.
  // Cached on the client (in-memory) for the life of this row + in Firestore
  // across sessions (see coachClient).
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachAdvice, setCoachAdvice] = useState<CoachAdvice | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachFeedback, setCoachFeedback] = useState<'up' | 'down' | null>(null);

  const loadCoachAdvice = React.useCallback(
    async (forceRefresh = false) => {
      setCoachLoading(true);
      setCoachError(null);
      try {
        const advice = await fetchCoachAdvice({
          subItemId: item.id,
          subItemTitle: item.title,
          subItemDefinition: item.question,
          subItemTool: item.tool,
          groupTitle,
          productType: (productType || '').trim() || 'General Hardware',
          standards,
          forceRefresh
        });
        setCoachAdvice(advice);
        setCoachFeedback(null);
      } catch (err: any) {
        setCoachError(err?.message || 'Failed to load advice');
      } finally {
        setCoachLoading(false);
      }
    },
    [item.id, item.title, item.question, item.tool, groupTitle, productType, standards]
  );

  const handleCoachToggle = () => {
    const next = !coachOpen;
    setCoachOpen(next);
    if (next && !coachAdvice && !coachLoading) {
      void loadCoachAdvice(false);
    }
  };

  const handleThumbs = async (kind: 'up' | 'down') => {
    if (!coachAdvice || coachFeedback) return;
    setCoachFeedback(kind);
    try {
      await submitCoachFeedback({
        subItemId: item.id,
        productType: (productType || '').trim() || 'General Hardware',
        kind,
        payload: coachAdvice
      });
    } catch (err) {
      // Non-fatal; revert the local state so the user can retry.
      console.warn('coach feedback failed:', err);
      setCoachFeedback(null);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-black uppercase tracking-tight text-slate-800 leading-snug">
              {item.title}
            </p>
            <span className="relative group inline-flex items-center">
              <Info
                size={13}
                className="text-slate-400 hover:text-slate-700 cursor-help"
                aria-label={tooltipText}
                tabIndex={0}
              />
              <span
                role="tooltip"
                className="pointer-events-none absolute left-0 bottom-full mb-2 z-30 w-64 max-w-[calc(100vw-1rem)] px-3 py-2 bg-slate-900 text-white text-[10px] font-medium leading-snug rounded shadow-xl opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
              >
                {item.tool && <span className="font-black text-blue-300">{item.tool} · </span>}
                {item.question}
              </span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={handleCoachToggle}
            title={coachOpen ? 'Hide coaching advice' : 'How to deliver this well — coaching advice'}
            aria-expanded={coachOpen}
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest border transition-colors ${
              coachOpen
                ? 'bg-blue-600 text-white border-blue-700'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300'
            }`}
          >
            <Sparkles size={10} />
            <span>Coacher</span>
          </button>
          {!readOnly && onDisable && (
            <button
              type="button"
              onClick={onDisable}
              title="Mark this metric as out of scope (N/A)"
              className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-red-600 transition-colors"
            >
              Disable
            </button>
          )}
          <span className={`text-sm font-black tracking-tight ${band.text}`}>
            {score}%
          </span>
        </div>
      </div>

      {item.kind === 'bar' ? (
        // When the sub-parameter owns deliverables (template or custom), the
        // bar is derived from deliverable completion (autoBarMode) — the
        // slider is suppressed so the user can't drift it out of sync with
        // what was actually delivered. If there are no deliverables at all,
        // the original manual slider behaviour is preserved.
        <div>
          <div className="relative h-2 bg-slate-100 rounded-full overflow-visible">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full pointer-events-none"
              animate={{ width: `${effectiveValue}%` }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              style={{
                background: `linear-gradient(90deg, ${band.fill}, ${band.stroke})`,
                boxShadow: `0 0 8px ${band.fill}60`
              }}
            />
            {!readOnly && !autoBarMode && (
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                aria-label={item.title}
              />
            )}
            <motion.div
              animate={{ left: `calc(${effectiveValue}% - 8px)` }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white pointer-events-none"
              style={{
                backgroundColor: band.stroke,
                boxShadow: `0 2px 6px ${band.fill}80`
              }}
            />
          </div>
          {autoBarMode && barCounts && (
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1 bg-slate-900 text-white px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest"
                title="Bar is derived from deliverable completion — check off deliverables below to fill it."
              >
                Auto · {barCounts.done}/{barCounts.total} delivered
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <input
            type="number"
            inputMode="decimal"
            value={Number.isFinite(value) ? value : ''}
            disabled={readOnly}
            min={0}
            step={item.unit?.includes('%') || item.unit === 'seconds / unit' ? 1 : 0.1}
            onChange={(e) => {
              const n = e.target.value === '' ? 0 : Number(e.target.value);
              onChange(Number.isFinite(n) ? n : 0);
            }}
            className="w-28 bg-slate-50 border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 focus:border-blue-500 outline-none disabled:opacity-60"
          />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {item.unit}
            {item.higherIsBetter != null && (
              <span className="ml-2 text-slate-300">
                · {item.higherIsBetter ? 'higher is better' : 'lower is better'}
              </span>
            )}
          </span>
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden ml-2">
            <motion.div
              animate={{ width: `${score}%` }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${band.fill}, ${band.stroke})` }}
            />
          </div>
        </div>
      )}

      {/* Notes — free-text up to 200 chars per sub-parameter */}
      <div className="mt-3">
        <textarea
          value={note}
          onChange={(e) => onChangeNote(e.target.value)}
          disabled={readOnly}
          maxLength={NOTE_MAX}
          rows={2}
          placeholder="Notes, context, blockers… (max 200 chars)"
          className="w-full bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] font-medium text-slate-700 placeholder-slate-400 focus:border-blue-500 outline-none disabled:opacity-60 resize-none"
        />
        <div className="flex justify-end">
          <span
            className={`text-[9px] font-black uppercase tracking-widest mt-1 ${
              note.length >= NOTE_MAX ? 'text-red-500' : 'text-slate-400'
            }`}
          >
            {note.length}/{NOTE_MAX}
          </span>
        </div>
      </div>

      {/* Deliverables — curated checklist + custom items, decoupled from score */}
      {item.deliverables && item.deliverables.length > 0 && (
        <DeliverableChecklist
          subItemId={item.id}
          templates={item.deliverables}
          state={deliverables}
          onToggleTemplate={onToggleTemplate}
          onAddCustom={onAddCustom}
          onToggleCustom={onToggleCustom}
          onRemoveCustom={onRemoveCustom}
          onHideTemplate={onHideTemplate}
          onUnhideTemplate={onUnhideTemplate}
          onSetCustomDueBy={onSetCustomDueBy}
          onWaiveTemplate={onWaiveTemplate}
          onUnwaiveTemplate={onUnwaiveTemplate}
          onSetTemplateWaiverReason={onSetTemplateWaiverReason}
          onWaiveCustom={onWaiveCustom}
          onUnwaiveCustom={onUnwaiveCustom}
          onSetCustomWaiverReason={onSetCustomWaiverReason}
          readOnly={readOnly}
        />
      )}

      {/* Coacher panel — collapsible, lazy-loaded on first open. */}
      <AnimatePresence initial={false}>
        {coachOpen && (
          <motion.div
            key="coach-panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <CoachPanel
              advice={coachAdvice}
              loading={coachLoading}
              error={coachError}
              subItemTitle={item.title}
              productType={(productType || '').trim() || 'General Hardware'}
              onRefresh={() => loadCoachAdvice(true)}
              onThumbsUp={() => handleThumbs('up')}
              onThumbsDown={() => handleThumbs('down')}
              feedbackGiven={coachFeedback}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Custom (user-added) sub-parameter row. Visually similar to MetricRow so
// users get consistent interaction, but with a "CUSTOM · not in score" badge
// and inline rename / remove controls. Deliberately has no notes field and
// no deliverable checklist (kept lean for Phase 1).
//
// Importantly, this row does NOT call scoreForItem / scoreForGroup — the
// value is purely informational. The band coloring is derived locally from
// the 0-100 value so the bar still visually animates like a real metric.
// ---------------------------------------------------------------------------

const CustomMetricRow: React.FC<{
  item: CustomSubItem;
  onChange: (v: number) => void;
  onChangeNote: (note: string) => void;
  onRename: (title: string) => void;
  onRemove: () => void;
  readOnly?: boolean;
}> = ({ item, onChange, onChangeNote, onRename, onRemove, readOnly }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const band = scoreBand(item.value);
  const note = item.note ?? '';

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== item.title) onRename(trimmed);
    else setDraft(item.title);
    setEditing(false);
  };

  return (
    <div className="border-l-2 border-dashed border-slate-300 pl-4">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {editing && !readOnly ? (
              <input
                type="text"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') {
                    setDraft(item.title);
                    setEditing(false);
                  }
                }}
                maxLength={80}
                className="text-[11px] font-black uppercase tracking-tight text-slate-800 bg-white border border-blue-400 px-2 py-0.5 outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => !readOnly && setEditing(true)}
                className={`text-[11px] font-black uppercase tracking-tight leading-snug text-left ${
                  readOnly
                    ? 'text-slate-800 cursor-default'
                    : 'text-slate-800 hover:text-blue-600 cursor-text'
                }`}
                title={readOnly ? item.title : 'Click to rename'}
              >
                {item.title}
              </button>
            )}
            <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 bg-slate-100 text-slate-500 border border-dashed border-slate-300 rounded-sm">
              Custom · not in score
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-sm font-black tracking-tight ${band.text}`}>
            {item.value}%
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${item.title}`}
              className="text-slate-300 hover:text-red-500 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="relative h-2 bg-slate-100 rounded-full overflow-visible">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full pointer-events-none"
          animate={{ width: `${item.value}%` }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          style={{
            background: `linear-gradient(90deg, ${band.fill}, ${band.stroke})`,
            boxShadow: `0 0 8px ${band.fill}60`,
            opacity: 0.75
          }}
        />
        {!readOnly && (
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={item.value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            aria-label={item.title}
          />
        )}
        <motion.div
          animate={{ left: `calc(${item.value}% - 8px)` }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white pointer-events-none"
          style={{
            backgroundColor: band.stroke,
            boxShadow: `0 2px 6px ${band.fill}80`,
            opacity: 0.85
          }}
        />
      </div>

      {/* Notes — same behavior as official MetricRow (200 char cap) */}
      <div className="mt-3">
        <textarea
          value={note}
          onChange={(e) => onChangeNote(e.target.value)}
          disabled={readOnly}
          maxLength={NOTE_MAX}
          rows={2}
          placeholder="Notes, context, blockers… (max 200 chars)"
          className="w-full bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] font-medium text-slate-700 placeholder-slate-400 focus:border-blue-500 outline-none disabled:opacity-60 resize-none"
        />
        <div className="flex justify-end">
          <span
            className={`text-[9px] font-black uppercase tracking-widest mt-1 ${
              note.length >= NOTE_MAX ? 'text-red-500' : 'text-slate-400'
            }`}
          >
            {note.length}/{NOTE_MAX}
          </span>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Inline "Add custom sub-parameter" control. Collapsed to a single button
// until clicked, then expands into a title input with Add / Cancel.
// ---------------------------------------------------------------------------

const AddCustomSubItem: React.FC<{
  groupId: string;
  onAdd: (title: string) => void;
  maxLength: number;
}> = ({ onAdd, maxLength }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setOpen(false);
      return;
    }
    onAdd(trimmed);
    setDraft('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 hover:border-slate-400 hover:bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 transition-colors"
      >
        <Plus size={12} />
        Add custom sub-parameter
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-blue-300 bg-blue-50/30">
      <input
        type="text"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft('');
            setOpen(false);
          }
        }}
        maxLength={maxLength}
        placeholder="e.g. Thermal compliance test pass rate"
        className="flex-1 bg-white border border-slate-300 px-3 py-2 text-[11px] font-medium text-slate-800 placeholder-slate-400 focus:border-blue-500 outline-none"
      />
      <button
        type="button"
        onClick={commit}
        disabled={!draft.trim()}
        className="px-3 py-2 text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft('');
          setOpen(false);
        }}
        className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800"
      >
        Cancel
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Per-sub-item deliverable checklist. Collapsed by default with a count
// summary; expands to show curated templates + custom items.
// Decoupled from scoring — purely a tracking aid.
// ---------------------------------------------------------------------------

const DeliverableChecklist: React.FC<{
  subItemId: string;
  templates: NonNullable<RampSubItem['deliverables']>;
  state: SubItemDeliverables;
  onToggleTemplate: (templateId: string) => void;
  onAddCustom: (title: string, dueBy?: ProductGate) => void;
  onToggleCustom: (customId: string) => void;
  onRemoveCustom: (customId: string) => void;
  onHideTemplate: (templateId: string) => void;
  onUnhideTemplate: (templateId: string) => void;
  onSetCustomDueBy: (customId: string, dueBy: ProductGate | undefined) => void;
  onWaiveTemplate: (templateId: string, reason?: string) => void;
  onUnwaiveTemplate: (templateId: string) => void;
  onSetTemplateWaiverReason: (templateId: string, reason: string) => void;
  onWaiveCustom: (customId: string, reason?: string) => void;
  onUnwaiveCustom: (customId: string) => void;
  onSetCustomWaiverReason: (customId: string, reason: string) => void;
  readOnly?: boolean;
}> = ({
  templates,
  state,
  onToggleTemplate,
  onAddCustom,
  onToggleCustom,
  onRemoveCustom,
  onHideTemplate,
  onUnhideTemplate,
  onSetCustomDueBy,
  onWaiveTemplate,
  onUnwaiveTemplate,
  onSetTemplateWaiverReason,
  onWaiveCustom,
  onUnwaiveCustom,
  onSetCustomWaiverReason,
  readOnly
}) => {
  const [expanded, setExpanded] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftGate, setDraftGate] = useState<ProductGate | ''>('');
  const [showHidden, setShowHidden] = useState(false);
  // null = no filter (show all). Otherwise only show items whose dueBy matches.
  const [gateFilter, setGateFilter] = useState<ProductGate | null>(null);
  // id of the row (template id OR custom id) whose waiver reason is being
  // edited inline. null = nothing is being edited. Kept local so edits on
  // one row don't affect another.
  const [reasonEditingId, setReasonEditingId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');

  const checkedSet = useMemo(() => new Set(state.checkedIds), [state.checkedIds]);
  const hiddenSet = useMemo(
    () => new Set(state.hiddenTemplateIds || []),
    [state.hiddenTemplateIds]
  );
  const waivedSet = useMemo(
    () => new Set(state.waivedTemplateIds || []),
    [state.waivedTemplateIds]
  );
  const waiverReasons = state.waiverReasons || {};
  const customs = state.custom || [];

  // Open the inline reason editor for a row, seeded with the current reason.
  const startEditReason = (id: string, current?: string) => {
    setReasonEditingId(id);
    setReasonDraft(current || '');
  };
  const cancelEditReason = () => {
    setReasonEditingId(null);
    setReasonDraft('');
  };
  const commitTemplateReason = (tid: string) => {
    onSetTemplateWaiverReason(tid, reasonDraft);
    cancelEditReason();
  };
  const commitCustomReason = (cid: string) => {
    onSetCustomWaiverReason(cid, reasonDraft);
    cancelEditReason();
  };

  // Only visible (non-hidden) templates count toward the progress summary —
  // hidden items are "not required for this project".
  const visibleTemplates = useMemo(
    () => templates.filter((t) => !hiddenSet.has(t.id)),
    [templates, hiddenSet]
  );
  const hiddenTemplates = useMemo(
    () => templates.filter((t) => hiddenSet.has(t.id)),
    [templates, hiddenSet]
  );

  // Counts-by-gate for the filter pill bar. Only counts visible (non-hidden)
  // templates and custom items — hidden = "not required".
  const gateCounts = useMemo(() => {
    const counts: Record<ProductGate, number> = {
      'CR': 0, 'PDR': 0, 'CDR': 0, 'TRR': 0, 'PRR': 0, 'MP': 0
    };
    visibleTemplates.forEach((t) => { if (t.dueBy) counts[t.dueBy]++; });
    customs.forEach((c) => { if (c.dueBy) counts[c.dueBy]++; });
    return counts;
  }, [visibleTemplates, customs]);

  const filteredTemplates = useMemo(
    () => gateFilter == null
      ? visibleTemplates
      : visibleTemplates.filter((t) => t.dueBy === gateFilter),
    [visibleTemplates, gateFilter]
  );
  const filteredCustoms = useMemo(
    () => gateFilter == null ? customs : customs.filter((c) => c.dueBy === gateFilter),
    [customs, gateFilter]
  );

  // "Done / total" summary respects the active gate filter so the header
  // reflects what the user is looking at. Waived items count as done.
  const total = filteredTemplates.length + filteredCustoms.length;
  const done =
    filteredTemplates.reduce(
      (acc, t) => acc + (checkedSet.has(t.id) || waivedSet.has(t.id) ? 1 : 0),
      0
    ) +
    filteredCustoms.reduce((acc, c) => acc + (c.done || c.waived ? 1 : 0), 0);
  const waivedCount =
    filteredTemplates.reduce((acc, t) => acc + (waivedSet.has(t.id) ? 1 : 0), 0) +
    filteredCustoms.reduce((acc, c) => acc + (c.waived ? 1 : 0), 0);

  const handleAdd = () => {
    const trimmed = draftTitle.trim();
    if (!trimmed) return;
    onAddCustom(trimmed, draftGate || undefined);
    setDraftTitle('');
    setDraftGate('');
  };

  return (
    <div className="mt-3 border border-slate-200 rounded-sm bg-slate-50">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-100 transition-colors"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          <ClipboardList size={12} className="text-slate-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
            Deliverables
          </span>
          <span className="text-[10px] font-black tabular-nums text-slate-500">
            · {done}/{total}
          </span>
          {waivedCount > 0 && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-[1px] text-[9px] font-black uppercase tracking-widest bg-amber-50 text-amber-700 border border-amber-200 rounded-sm"
              title={`${waivedCount} waived`}
            >
              <FileWarning size={9} />
              {waivedCount} waived
            </span>
          )}
        </span>
        <ChevronDown
          size={14}
          className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 space-y-2 border-t border-slate-200">
              {/* Gate filter pill bar — "All" + one pill per gate, showing count. */}
              <div className="flex flex-wrap items-center gap-1 pt-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mr-1">
                  Due by
                </span>
                <button
                  type="button"
                  onClick={() => setGateFilter(null)}
                  className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-widest border rounded-sm transition-colors ${
                    gateFilter == null
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  All
                </button>
                {PRODUCT_GATE_ORDER.map((g) => {
                  const active = gateFilter === g;
                  const count = gateCounts[g];
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGateFilter(active ? null : g)}
                      disabled={count === 0}
                      className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-widest border rounded-sm transition-colors ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900'
                          : count === 0
                            ? 'bg-white text-slate-300 border-slate-100 cursor-not-allowed'
                            : `${GATE_CHIP_STYLES[g]} hover:opacity-80`
                      }`}
                      title={GATE_LABELS[g]}
                    >
                      {g} · {count}
                    </button>
                  );
                })}
              </div>

              {filteredTemplates.length > 0 && (
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-2">
                  Reference checklist
                </p>
              )}
              <ul className="space-y-1">
                {filteredTemplates.map((tmpl) => {
                  const waived = waivedSet.has(tmpl.id);
                  const checked = !waived && checkedSet.has(tmpl.id);
                  const reason = waiverReasons[tmpl.id];
                  const editing = reasonEditingId === tmpl.id;
                  return (
                    <li
                      key={tmpl.id}
                      className={`group flex flex-col gap-1 px-2 py-1.5 rounded-sm transition-colors ${
                        waived ? 'bg-amber-50/50' : 'hover:bg-white'
                      }`}
                    >
                      <div className="flex items-start gap-1">
                        <button
                          type="button"
                          onClick={() => !waived && onToggleTemplate(tmpl.id)}
                          disabled={readOnly || waived}
                          className="flex-1 flex items-start gap-2 text-left disabled:cursor-not-allowed"
                          title={
                            waived
                              ? 'Waived — uncheckable. Unwaive to restore.'
                              : undefined
                          }
                        >
                          {waived ? (
                            <FileWarning
                              size={14}
                              className="flex-shrink-0 mt-0.5 text-amber-600"
                            />
                          ) : checked ? (
                            <CheckSquare
                              size={14}
                              className="flex-shrink-0 mt-0.5 text-emerald-600"
                            />
                          ) : (
                            <Square size={14} className="flex-shrink-0 mt-0.5 text-slate-400" />
                          )}
                          <span
                            className={`text-[11px] leading-snug ${
                              waived
                                ? 'text-amber-800 line-through decoration-amber-400/70'
                                : checked
                                ? 'text-slate-400 line-through'
                                : 'text-slate-700 font-medium'
                            }`}
                          >
                            {tmpl.title}
                          </span>
                        </button>
                        {waived && (
                          <span
                            className="flex-shrink-0 mt-0.5 px-1.5 py-[1px] text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 border border-amber-300 rounded-sm"
                            title="Formally accepted deviation"
                          >
                            Waived
                          </span>
                        )}
                        {tmpl.dueBy && (
                          <span
                            className={`flex-shrink-0 mt-0.5 px-1.5 py-[1px] text-[9px] font-black uppercase tracking-widest border rounded-sm ${GATE_CHIP_STYLES[tmpl.dueBy]}`}
                            title={`Due by ${GATE_LABELS[tmpl.dueBy]}`}
                          >
                            {tmpl.dueBy}
                          </span>
                        )}
                        {!readOnly && (
                          <>
                            {waived ? (
                              <button
                                type="button"
                                onClick={() => onUnwaiveTemplate(tmpl.id)}
                                className="flex-shrink-0 mt-0.5 text-slate-400 hover:text-blue-600 transition-colors"
                                aria-label={`Unwaive ${tmpl.title}`}
                                title="Unwaive (restore as required)"
                              >
                                <RotateCcw size={12} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  onWaiveTemplate(tmpl.id);
                                  startEditReason(tmpl.id, '');
                                }}
                                className="flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-400 hover:text-amber-600 transition-all"
                                aria-label={`Waive ${tmpl.title}`}
                                title="Waive — formally accept as not-going-to-be-done"
                              >
                                <FileWarning size={12} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onHideTemplate(tmpl.id)}
                              className="flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-400 hover:text-red-600 transition-all"
                              aria-label={`Remove ${tmpl.title} from this project`}
                              title="Not required for this project"
                            >
                              <X size={12} />
                            </button>
                          </>
                        )}
                      </div>

                      {/* Waiver reason — inline editor when editing, read-only
                          display otherwise. Only rendered for waived items. */}
                      {waived && !editing && (
                        <div className="pl-5 flex items-start gap-2">
                          <span className="text-[10px] text-amber-800/90 leading-snug italic flex-1">
                            {reason
                              ? `Reason: ${reason}`
                              : 'No reason recorded.'}
                          </span>
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => startEditReason(tmpl.id, reason)}
                              className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest text-amber-700 hover:text-amber-900 transition-colors"
                            >
                              {reason ? 'Edit' : 'Add reason'}
                            </button>
                          )}
                        </div>
                      )}
                      {waived && editing && !readOnly && (
                        <div className="pl-5 flex items-start gap-2">
                          <input
                            type="text"
                            autoFocus
                            value={reasonDraft}
                            onChange={(e) => setReasonDraft(e.target.value.slice(0, 240))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitTemplateReason(tmpl.id);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelEditReason();
                              }
                            }}
                            placeholder="Why is this being waived?"
                            maxLength={240}
                            className="flex-1 bg-white border border-amber-300 px-2 py-1 text-[10px] text-slate-800 placeholder-slate-400 focus:border-amber-500 outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => commitTemplateReason(tmpl.id)}
                            className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest text-amber-800 hover:text-amber-900 transition-colors"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditReason}
                            className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {filteredTemplates.length === 0 && visibleTemplates.length > 0 && (
                <p className="text-[10px] font-medium text-slate-400 italic px-2 py-1">
                  No reference items due by {gateFilter}.
                </p>
              )}

              {visibleTemplates.length === 0 && templates.length > 0 && (
                <p className="text-[10px] font-medium text-slate-400 italic px-2 py-1">
                  All reference items removed — add a custom one below or restore from hidden.
                </p>
              )}

              {hiddenTemplates.length > 0 && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowHidden((v) => !v)}
                    className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors"
                    aria-expanded={showHidden}
                  >
                    <ChevronDown
                      size={10}
                      className={`transition-transform ${showHidden ? 'rotate-180' : '-rotate-90'}`}
                    />
                    {hiddenTemplates.length} removed · {showHidden ? 'hide' : 'restore'}
                  </button>
                  {showHidden && (
                    <ul className="mt-1 space-y-1 pl-3 border-l border-dashed border-slate-300">
                      {hiddenTemplates.map((tmpl) => (
                        <li
                          key={tmpl.id}
                          className="flex items-center gap-2 px-2 py-1 rounded-sm"
                        >
                          <span className="flex-1 text-[10px] text-slate-400 line-through leading-snug">
                            {tmpl.title}
                          </span>
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => onUnhideTemplate(tmpl.id)}
                              className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-blue-600 transition-colors"
                            >
                              Restore
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {filteredCustoms.length > 0 && (
                <>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-3">
                    Custom items
                  </p>
                  <ul className="space-y-1">
                    {filteredCustoms.map((c) => {
                      const editing = reasonEditingId === c.id;
                      return (
                        <li
                          key={c.id}
                          className={`flex flex-col gap-1 px-2 py-1.5 rounded-sm transition-colors group ${
                            c.waived ? 'bg-amber-50/50' : 'hover:bg-white'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <button
                              type="button"
                              onClick={() => !c.waived && onToggleCustom(c.id)}
                              disabled={readOnly || !!c.waived}
                              className="flex-shrink-0 mt-0.5 disabled:cursor-not-allowed"
                              aria-label={
                                c.waived
                                  ? 'Waived — uncheckable'
                                  : c.done
                                  ? 'Mark as not done'
                                  : 'Mark as done'
                              }
                              title={c.waived ? 'Waived — unwaive to restore' : undefined}
                            >
                              {c.waived ? (
                                <FileWarning size={14} className="text-amber-600" />
                              ) : c.done ? (
                                <CheckSquare size={14} className="text-emerald-600" />
                              ) : (
                                <Square size={14} className="text-slate-400" />
                              )}
                            </button>
                            <span
                              className={`flex-1 text-[11px] leading-snug ${
                                c.waived
                                  ? 'text-amber-800 line-through decoration-amber-400/70'
                                  : c.done
                                  ? 'text-slate-400 line-through'
                                  : 'text-slate-700 font-medium'
                              }`}
                            >
                              {c.title}
                            </span>
                            {c.waived && (
                              <span
                                className="flex-shrink-0 mt-0.5 px-1.5 py-[1px] text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 border border-amber-300 rounded-sm"
                                title="Formally accepted deviation"
                              >
                                Waived
                              </span>
                            )}
                            {/* Gate picker — dropdown styled as a pill. An empty
                                option means "not assigned to a gate". */}
                            {!readOnly ? (
                              <select
                                value={c.dueBy || ''}
                                onChange={(e) =>
                                  onSetCustomDueBy(
                                    c.id,
                                    (e.target.value || undefined) as ProductGate | undefined
                                  )
                                }
                                className={`flex-shrink-0 mt-0.5 px-1.5 py-[1px] text-[9px] font-black uppercase tracking-widest border rounded-sm cursor-pointer focus:outline-none ${
                                  c.dueBy
                                    ? GATE_CHIP_STYLES[c.dueBy]
                                    : 'bg-white text-slate-400 border-dashed border-slate-300 hover:border-slate-500'
                                }`}
                                aria-label="Due by gate"
                              >
                                <option value="">No gate</option>
                                {PRODUCT_GATE_ORDER.map((g) => (
                                  <option key={g} value={g}>{g}</option>
                                ))}
                              </select>
                            ) : c.dueBy ? (
                              <span
                                className={`flex-shrink-0 mt-0.5 px-1.5 py-[1px] text-[9px] font-black uppercase tracking-widest border rounded-sm ${GATE_CHIP_STYLES[c.dueBy]}`}
                              >
                                {c.dueBy}
                              </span>
                            ) : null}
                            {!readOnly && (
                              <>
                                {c.waived ? (
                                  <button
                                    type="button"
                                    onClick={() => onUnwaiveCustom(c.id)}
                                    className="flex-shrink-0 mt-0.5 text-slate-400 hover:text-blue-600 transition-colors"
                                    aria-label={`Unwaive ${c.title}`}
                                    title="Unwaive (restore as required)"
                                  >
                                    <RotateCcw size={12} />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onWaiveCustom(c.id);
                                      startEditReason(c.id, '');
                                    }}
                                    className="flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-400 hover:text-amber-600 transition-all"
                                    aria-label={`Waive ${c.title}`}
                                    title="Waive — formally accept as not-going-to-be-done"
                                  >
                                    <FileWarning size={12} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onRemoveCustom(c.id)}
                                  className="flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600 transition-all"
                                  aria-label={`Remove ${c.title}`}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </div>

                          {c.waived && !editing && (
                            <div className="pl-5 flex items-start gap-2">
                              <span className="text-[10px] text-amber-800/90 leading-snug italic flex-1">
                                {c.waiverReason
                                  ? `Reason: ${c.waiverReason}`
                                  : 'No reason recorded.'}
                              </span>
                              {!readOnly && (
                                <button
                                  type="button"
                                  onClick={() => startEditReason(c.id, c.waiverReason)}
                                  className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest text-amber-700 hover:text-amber-900 transition-colors"
                                >
                                  {c.waiverReason ? 'Edit' : 'Add reason'}
                                </button>
                              )}
                            </div>
                          )}
                          {c.waived && editing && !readOnly && (
                            <div className="pl-5 flex items-start gap-2">
                              <input
                                type="text"
                                autoFocus
                                value={reasonDraft}
                                onChange={(e) => setReasonDraft(e.target.value.slice(0, 240))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    commitCustomReason(c.id);
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancelEditReason();
                                  }
                                }}
                                placeholder="Why is this being waived?"
                                maxLength={240}
                                className="flex-1 bg-white border border-amber-300 px-2 py-1 text-[10px] text-slate-800 placeholder-slate-400 focus:border-amber-500 outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => commitCustomReason(c.id)}
                                className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest text-amber-800 hover:text-amber-900 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditReason}
                                className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              {gateFilter != null
                && filteredTemplates.length === 0
                && filteredCustoms.length === 0
                && (visibleTemplates.length > 0 || customs.length > 0) && (
                  <p className="text-[10px] font-medium text-slate-400 italic px-2 py-1">
                    Nothing due by {gateFilter} in this sub-parameter.
                  </p>
                )}

              {!readOnly && (
                <div className="pt-2 mt-2 border-t border-slate-200 flex gap-2">
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value.slice(0, 120))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAdd();
                      }
                    }}
                    placeholder="Add custom deliverable…"
                    maxLength={120}
                    className="flex-1 bg-white border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-800 placeholder-slate-400 focus:border-blue-500 outline-none"
                  />
                  <select
                    value={draftGate}
                    onChange={(e) => setDraftGate(e.target.value as ProductGate | '')}
                    className="bg-white border border-slate-200 px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 focus:border-blue-500 outline-none"
                    aria-label="Due by gate"
                  >
                    <option value="">No gate</option>
                    {PRODUCT_GATE_ORDER.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!draftTitle.trim()}
                    className="bg-slate-900 hover:bg-slate-700 text-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus size={10} />
                    Add
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ---------------------------------------------------------------------------
// General Info tab — dates, status, free-form info, attachments.
// ---------------------------------------------------------------------------

const iconForAttachment = (name: string, url: string) => {
  const combined = `${name} ${url}`.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|bmp|heic)(\?|#|$)/.test(combined)) return ImageIcon;
  if (/\.(eml|msg)(\?|#|$)/.test(combined) || url.startsWith('mailto:')) return Mail;
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|csv|rtf|odt|ods|odp)(\?|#|$)/.test(combined)) return FileText;
  if (/drive\.google\.com|docs\.google\.com|sheets|slides/.test(combined)) return FileText;
  return FileIcon;
};

const hostFromUrl = (url: string): string => {
  try {
    const u = new URL(url);
    return u.host || u.protocol.replace(':', '');
  } catch {
    return '';
  }
};

const STATUS_PILL_STYLES: Record<InfoStatus, string> = {
  'TBD':        'bg-slate-100 text-slate-700 border-slate-300',
  'In Process': 'bg-blue-50 text-blue-700 border-blue-300',
  'Completed':  'bg-emerald-50 text-emerald-700 border-emerald-300',
  'Cancelled':  'bg-red-50 text-red-700 border-red-300'
};

const PROJECT_NAME_MAX = 80;
const PRODUCT_TYPE_MAX = 40;

const GeneralInfoPanel: React.FC<{
  projectName: string;
  productType: string;
  standards: string[];
  onChangeStandards: (next: string[]) => void;
  startDate: string;
  endDate: string;
  infoStatus: InfoStatus;
  generalInfo: string;
  currentGate: ProductGate | '';
  gateTargets: Partial<Record<ProductGate, string>>;
  attachments: ProjectAttachment[];
  attachmentError: string | null;
  templateId?: string;
  enabledCount: number;
  totalCount: number;
  onEditScope: () => void;
  onChangeProjectName: (v: string) => void;
  onChangeProductType: (v: string) => void;
  onChangeStartDate: (v: string) => void;
  onChangeEndDate: (v: string) => void;
  onChangeStatus: (v: InfoStatus) => void;
  onChangeGeneralInfo: (v: string) => void;
  onChangeCurrentGate: (v: ProductGate | '') => void;
  onChangeGateTarget: (gate: ProductGate, date: string) => void;
  onAddAttachment: (name: string, url: string) => void;
  onRemoveAttachment: (att: ProjectAttachment) => void;
  readOnly?: boolean;
}> = ({
  projectName,
  productType,
  standards,
  onChangeStandards,
  startDate,
  endDate,
  infoStatus,
  generalInfo,
  currentGate,
  gateTargets,
  attachments,
  attachmentError,
  templateId,
  enabledCount,
  totalCount,
  onEditScope,
  onChangeProjectName,
  onChangeProductType,
  onChangeStartDate,
  onChangeEndDate,
  onChangeStatus,
  onChangeGeneralInfo,
  onChangeCurrentGate,
  onChangeGateTarget,
  onAddAttachment,
  onRemoveAttachment,
  readOnly = false
}) => {
  const template = getTemplate(templateId);
  const scopeIsFull = enabledCount === totalCount;
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  const handleAdd = () => {
    if (readOnly) return;
    if (!linkUrl.trim()) return;
    onAddAttachment(linkName, linkUrl);
    setLinkName('');
    setLinkUrl('');
  };

  const dateInvalid = !!(startDate && endDate && endDate < startDate);

  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-xl overflow-hidden">
      {/* Panel header */}
      <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList size={18} className="text-blue-400" />
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/70 mb-1">
              Project Overview
            </p>
            <h3 className="text-lg font-black uppercase tracking-tight leading-tight">
              General Info
            </h3>
          </div>
        </div>
        <span
          className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 border ${STATUS_PILL_STYLES[infoStatus]}`}
        >
          {infoStatus}
        </span>
      </div>

      <div className="p-6 space-y-6">
        {/* Identity — project name + product type. Editable post-creation. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
              Project Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => onChangeProjectName(e.target.value)}
              disabled={readOnly}
              maxLength={PROJECT_NAME_MAX}
              placeholder="Project name"
              className="w-full bg-slate-50 border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-900 focus:border-blue-500 outline-none disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
              Product Type
            </label>
            <input
              type="text"
              value={productType}
              onChange={(e) => onChangeProductType(e.target.value)}
              disabled={readOnly}
              maxLength={PRODUCT_TYPE_MAX}
              placeholder="e.g. Medical Device"
              className="w-full bg-slate-50 border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-900 focus:border-blue-500 outline-none disabled:opacity-60"
            />
          </div>
        </div>

        {/* Applicable Standards — editable post-creation. Feeds the Coacher
            cache key and the AI risk-analysis prompt so advice/findings get
            compliance-weighted without the user having to re-select anywhere. */}
        <StandardsPicker
          productSegment={productType}
          selected={standards}
          onChange={onChangeStandards}
          compact
          disabled={readOnly}
        />

        {/* Dates + Status row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Start Date */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
              Start Date
            </label>
            <div className="relative">
              <CalendarIcon
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                type="date"
                value={startDate}
                onChange={(e) => onChangeStartDate(e.target.value)}
                disabled={readOnly}
                className="w-full bg-slate-50 border border-slate-200 pl-9 pr-3 py-2.5 text-sm font-medium text-slate-900 focus:border-blue-500 outline-none disabled:opacity-60"
              />
            </div>
          </div>

          {/* End Date */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
              End Date
            </label>
            <div className="relative">
              <CalendarIcon
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => onChangeEndDate(e.target.value)}
                disabled={readOnly}
                className={`w-full bg-slate-50 border pl-9 pr-3 py-2.5 text-sm font-medium text-slate-900 focus:border-blue-500 outline-none disabled:opacity-60 ${
                  dateInvalid ? 'border-red-400' : 'border-slate-200'
                }`}
              />
            </div>
            {dateInvalid && (
              <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-red-500">
                End date must be on or after start date
              </p>
            )}
          </div>

          {/* Status */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
              Status
            </label>
            <select
              value={infoStatus}
              onChange={(e) => onChangeStatus(e.target.value as InfoStatus)}
              disabled={readOnly}
              className="w-full bg-slate-50 border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-900 focus:border-blue-500 outline-none disabled:opacity-60 appearance-none cursor-pointer"
            >
              {INFO_STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Scope row — template + enabled count + edit modal trigger */}
        <div className="border-t border-slate-100 pt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
              Scope
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-sm px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <ClipboardList size={14} className="text-slate-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[12px] font-black text-slate-800">
                  {template.name}
                  <span className="ml-2 text-[10px] font-black tabular-nums text-slate-500">
                    · {enabledCount}/{totalCount} metrics
                  </span>
                  {!scopeIsFull && (
                    <span className="ml-2 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200">
                      Reduced scope
                    </span>
                  )}
                </p>
                <p className="text-[10px] font-medium text-slate-500 mt-0.5 truncate">
                  {template.description}
                </p>
              </div>
            </div>
            {!readOnly && (
              <button
                type="button"
                onClick={onEditScope}
                className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-blue-600 transition-colors flex-shrink-0"
              >
                Edit Scope →
              </button>
            )}
          </div>
        </div>

        {/* Stage-gate section */}
        <div className="border-t border-slate-100 pt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                Stage Gates
              </span>
              <span className="relative group inline-flex items-center">
                <Info
                  size={13}
                  className="text-slate-400 hover:text-slate-700 cursor-help"
                  tabIndex={0}
                />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-0 top-full mt-2 z-30 w-72 max-w-[calc(100vw-1rem)] px-3 py-2 bg-slate-900 text-white text-[10px] font-medium leading-snug rounded shadow-xl opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                >
                  CR = Concept Review · PDR = Preliminary Design Review · CDR = Critical Design Review · TRR = Test Readiness Review · PRR = Production Readiness Review. Set target dates to help the AI reason about schedule pressure.
                </span>
              </span>
            </div>
            {currentGate && (
              <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200">
                Currently at {currentGate}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Current gate dropdown */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
                Current Gate
              </label>
              <select
                value={currentGate}
                onChange={(e) =>
                  onChangeCurrentGate((e.target.value || '') as ProductGate | '')
                }
                disabled={readOnly}
                className="w-full bg-slate-50 border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-900 focus:border-blue-500 outline-none disabled:opacity-60 appearance-none cursor-pointer"
              >
                <option value="">— Not set —</option>
                {GATE_OPTIONS.map((g) => (
                  <option key={g} value={g}>
                    {GATE_LABELS[g]}
                  </option>
                ))}
              </select>
            </div>

            {/* Target dates for each gate */}
            {GATE_OPTIONS.map((gate) => (
              <div key={gate}>
                <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
                  {gate} Target
                </label>
                <div className="relative">
                  <CalendarIcon
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  />
                  <input
                    type="date"
                    value={gateTargets[gate] || ''}
                    onChange={(e) => onChangeGateTarget(gate, e.target.value)}
                    disabled={readOnly}
                    className={`w-full bg-slate-50 border pl-9 pr-3 py-2.5 text-sm font-medium text-slate-900 focus:border-blue-500 outline-none disabled:opacity-60 ${
                      currentGate === gate ? 'border-blue-400' : 'border-slate-200'
                    }`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* General Info textarea */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
            General Info
          </label>
          <textarea
            value={generalInfo}
            onChange={(e) => onChangeGeneralInfo(e.target.value)}
            disabled={readOnly}
            maxLength={GENERAL_INFO_MAX}
            rows={5}
            placeholder="Context, goals, decisions, blockers… (max 400 chars)"
            className="w-full bg-slate-50 border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 placeholder-slate-400 focus:border-blue-500 outline-none disabled:opacity-60 resize-none"
          />
          <div className="flex justify-end">
            <span
              className={`text-[9px] font-black uppercase tracking-widest mt-1 ${
                generalInfo.length >= GENERAL_INFO_MAX ? 'text-red-500' : 'text-slate-400'
              }`}
            >
              {generalInfo.length}/{GENERAL_INFO_MAX}
            </span>
          </div>
        </div>

        {/* Attachments — link-based, no file hosting */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2">
              <LinkIcon size={12} />
              Attachments
              {attachments.length > 0 && (
                <span className="text-slate-400">· {attachments.length}</span>
              )}
            </label>
          </div>

          {!readOnly && (
            <div className="bg-slate-50 border border-slate-200 rounded-sm p-4 space-y-3">
              <p className="text-[10px] font-medium text-slate-500 leading-relaxed">
                Paste a link from Google Drive, Dropbox, OneDrive, a shared mailbox, or any URL.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2">
                <input
                  type="text"
                  value={linkName}
                  onChange={(e) => setLinkName(e.target.value.slice(0, ATTACHMENT_NAME_MAX))}
                  placeholder="Label (optional)"
                  maxLength={ATTACHMENT_NAME_MAX}
                  className="bg-white border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-800 placeholder-slate-400 focus:border-blue-500 outline-none"
                />
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAdd();
                    }
                  }}
                  placeholder="https://drive.google.com/…"
                  className="bg-white border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-800 placeholder-slate-400 focus:border-blue-500 outline-none"
                />
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!linkUrl.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Plus size={12} />
                  Add Link
                </button>
              </div>
            </div>
          )}

          {attachmentError && (
            <div className="mt-3 p-3 bg-red-50 text-red-700 text-[11px] font-bold border-l-4 border-red-500 flex items-start gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{attachmentError}</span>
            </div>
          )}

          {attachments.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 border border-slate-200 rounded-sm">
              {attachments.map((att) => {
                const Icon = iconForAttachment(att.name, att.url);
                const host = hostFromUrl(att.url);
                return (
                  <li
                    key={`${att.url}-${att.addedAt}`}
                    className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-slate-50 transition-colors"
                  >
                    <Icon size={18} className="text-slate-500 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-black text-slate-800 truncate">
                        {att.name}
                      </p>
                      <p className="text-[10px] font-medium text-slate-400 truncate">
                        {host || att.url}
                      </p>
                    </div>
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-blue-600 transition-colors"
                      aria-label={`Open ${att.name}`}
                    >
                      <ExternalLink size={14} />
                    </a>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => onRemoveAttachment(att)}
                        className="text-slate-400 hover:text-red-600 transition-colors"
                        aria-label={`Remove ${att.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

    </div>
  );
};

export default ProjectDeepDive;
