// ---------------------------------------------------------------------------
// ProductBomTool — Per-project BOM evolution tracker with AI Impact analysis.
//
// Lives in the ProjectDeepDive Project Tools launcher (between PFMEA and
// Process Map). Mirrors the chrome of MeetingsTool / PFMEATool / ProcessMap
// (slate-900 header, list + form views, blue "Upload" CTA).
//
// Purpose: capture BOM revisions over the life of the project (Rev A, Rev B,
// Pre-CDR, Post-PRR, etc.), auto-diff against the previous revision, and on
// demand call /api/bom-impact-analyze to surface which readiness items shift
// and what new risks appear when a part changes.
//
// Data flow:
//   1. User picks xlsx / csv → bomParser.parseBomFile → headers + raw rows
//      + suggested column mapping (heuristic).
//   2. UI shows mapping-confirmation panel. User can override per-field.
//      Final mapping persists to project.bomColumnMap so subsequent uploads
//      to the SAME project apply it silently — the tool "learns" the
//      user's internal-PN column convention.
//   3. bomParser.applyMapping(rawRows, mapping) → BomLine[].
//   4. Save to /productBoms — immutable doc per upload (same posture as
//      docGuardAudits).
//   5. On view, the diff against the most recent prior BOM is computed
//      live in memory. "Analyze Impact" button runs the AI handler and
//      writes the result back into the same doc (one-time write to the
//      impactAnalysis subfield; subsequent re-runs append? No — v1 keeps
//      one analysis per BOM, "Re-analyze" overwrites).
//
// Wait — the rule has `allow update: if false` on docGuardAudits. We want
// to allow ONE update on productBoms specifically to write the impact
// analysis post-save, so the rule uses a softer posture: update is allowed
// IF the userId / projectId / lines / columnMap / uploadedAtMs are
// unchanged. This is enforced in firestore.rules.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Upload,
  Loader2,
  ArrowLeft,
  Save,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Boxes,
  Sparkles,
  ChevronDown,
  ChevronRight,
  FileText,
  Building2,
  Hash,
  X,
  GitBranch,
  ShieldCheck
} from 'lucide-react';
import { db, auth } from './firebase.ts';
import { logActivity } from './activityLogger.ts';
import { PushToOpenItemsInline } from './OpenItemsPanel.tsx';
import { checkBomVsDecisions, type CrossCheckResult } from './crossCheckEngine.ts';
import CrossCheckBanner from './CrossCheckBanner.tsx';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import {
  parseBomFile,
  applyMapping,
  detectColumnMapping,
  type BomLine,
  type ColumnMapping,
  type ParseResult
} from './bomParser.ts';
import {
  diffBoms,
  changeKindLabel,
  type BomDiff,
  type ChangeKind
} from './bomDiff.ts';
import {
  analyzeBomImpact,
  type BomImpactAnalysis,
  type ProductGate
} from './productBomClient.ts';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface ProductBom {
  id: string;                       // Firestore doc id ('' for unsaved)
  userId: string;
  projectId: string;
  fileName: string;
  versionLabel: string;             // user-provided "Rev A" etc.
  /**
   * When the change goes into EFFECT (vs. when it was uploaded). Defaults
   * to upload date but the user can override — e.g. backdate to an ECO
   * effective date. UTC-anchored midnight (same convention as meetings).
   */
  effectiveDateMs: number;
  /**
   * Why this revision was created — ECO #, supplier rationale, ramp gate,
   * etc. First-class field separate from `versionLabel`. Up to 500 chars.
   * Empty allowed but heavily nudged by placeholder + AI prompt context.
   */
  reasonForChange: string;
  uploadedAtMs: number;
  uploadedAtGate?: ProductGate;
  /**
   * Where this BOM doc came from. v1 = always 'upload' (xlsx/csv hand-drop).
   * Reserved for future PLM-API integration: a 'plm' source would carry an
   * externalId referencing the source system's BOM doc. The rest of the
   * pipeline (lines, diff, AI impact) is source-agnostic.
   */
  source: 'upload' | 'plm' | 'manual';
  externalId?: string;              // PLM-side BOM doc id when source='plm'
  /** Optional ECO / change-control context. Populated on the upload form. */
  eco?: EcoContext;
  columnMap: ColumnMapping;
  lines: BomLine[];
  totalLines: number;
  impactAnalysis?: SavedImpactAnalysis;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface SavedImpactAnalysis {
  baselineBomId: string;
  baselineLabel: string;
  generatedAtMs: number;
  narrative: string;
  affectedRampItems: BomImpactAnalysis['affectedRampItems'];
  newRisks: BomImpactAnalysis['newRisks'];
  topActions: BomImpactAnalysis['topActions'];
}

// ---------------------------------------------------------------------------
// ECO / Change Control context — lightweight PLM-awareness layer.
// BridgeOps doesn't manage ECOs; it monitors ECO health as a readiness signal.
// The PLM owns the ECO. We just capture the reference + impact status so the
// AI can reason about design stability at the current gate.
// ---------------------------------------------------------------------------
export type EcoStatus = 'open' | 'under_review' | 'approved' | 'implemented';
export type EcoArea  = 'bom' | 'process' | 'design' | 'documentation' | 'multiple';

export interface EcoContext {
  ref: string;          // ECO number from PLM, e.g. "ECO-2024-123"
  title: string;        // short description ≤150 char
  status: EcoStatus;
  area: EcoArea;
  blocking: boolean;    // is this ECO blocking a gate deliverable?
}

const ECO_REF_MAX   = 50;
const ECO_TITLE_MAX = 150;

const ECO_STATUS_LABELS: Record<EcoStatus, string> = {
  open:         'Open',
  under_review: 'Under Review',
  approved:     'Approved',
  implemented:  'Implemented',
};

const ECO_AREA_LABELS: Record<EcoArea, string> = {
  bom:           'BOM',
  process:       'Process',
  design:        'Design',
  documentation: 'Documentation',
  multiple:      'Multiple Areas',
};

const VERSION_MAX = 60;
const REASON_MAX = 500;

// Date helpers — effectiveDate stores a calendar date (UTC midnight)
// so it renders consistently regardless of the user's local TZ. Same
// convention as MeetingsTool.dateMs.
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
  if (!v) return Date.now();
  const [y, m, d] = v.split('-').map((p) => Number(p));
  if (!y || !m || !d) return Date.now();
  return Date.UTC(y, m - 1, d);
}
function formatEffectiveDate(ms: number): string {
  if (!ms || !isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUploadedAt(ms: number): string {
  if (!ms || !isFinite(ms)) return '—';
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function shortRef(l: BomLine): string {
  return (
    l.internalPn ||
    l.mpn ||
    l.refDes ||
    (l.description ? l.description.slice(0, 40) : '(unidentified)')
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProductBomToolProps {
  projectId: string;
  /** Project context, passed in so the AI handler gets gate/standards. */
  projectName?: string;
  productType?: string;
  currentGate?: ProductGate;
  gateTargets?: Partial<Record<ProductGate, string>>;
  standards?: string[];
  templateName?: string;
  disabledItemIds?: string[];
  readOnly?: boolean;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'view'; bomId: string }
  | { kind: 'new' };

const ProductBomTool: React.FC<ProductBomToolProps> = ({
  projectId,
  projectName,
  productType,
  currentGate,
  gateTargets,
  standards,
  templateName,
  disabledItemIds,
  readOnly = false
}) => {
  const [boms, setBoms] = useState<ProductBom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  // Layer-2 cross-check: banner shown when a supplier swap conflicts with a decision.
  const [crossCheck, setCrossCheck] = useState<CrossCheckResult | null>(null);
  // The user-confirmed column mapping for THIS project. Loaded from
  // project.bomColumnMap on mount; written back on first save so subsequent
  // uploads apply silently — this is the "learns the user's convention" piece.
  const [savedColumnMap, setSavedColumnMap] = useState<ColumnMapping | undefined>(
    undefined
  );

  const uid = auth.currentUser?.uid ?? '';

  // Pull the saved column map off the project doc once on mount.
  useEffect(() => {
    let canceled = false;
    (async () => {
      if (!uid || !projectId) return;
      try {
        const snap = await getDoc(doc(db, 'projects', projectId));
        if (canceled) return;
        const data = snap.data() as { bomColumnMap?: ColumnMapping } | undefined;
        if (data?.bomColumnMap) setSavedColumnMap(data.bomColumnMap);
      } catch (e) {
        // Non-fatal — heuristic detection still runs as fallback.
        console.warn('[ProductBomTool] could not load project.bomColumnMap', e);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [uid, projectId]);

  const persistColumnMap = async (mapping: ColumnMapping) => {
    setSavedColumnMap(mapping);
    try {
      await updateDoc(doc(db, 'projects', projectId), {
        bomColumnMap: mapping,
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      // Non-fatal — the BOM saved fine; we just won't auto-apply next time.
      console.warn('[ProductBomTool] could not persist bomColumnMap', e);
    }
  };

  const loadBoms = async () => {
    if (!uid || !projectId) {
      setBoms([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = query(
        collection(db, 'productBoms'),
        where('userId', '==', uid),
        where('projectId', '==', projectId),
        orderBy('uploadedAtMs', 'desc')
      );
      const snap = await getDocs(q);
      const rows: ProductBom[] = snap.docs.map((d) => {
        const data = d.data() as Omit<ProductBom, 'id'>;
        return { ...data, id: d.id };
      });
      setBoms(rows);
    } catch (e: any) {
      console.error('[ProductBomTool] load failed', e);
      setError(e?.message || 'Failed to load BOMs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBoms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, projectId]);

  const deleteBom = async (b: ProductBom) => {
    if (!b.id) return;
    if (
      !confirm(
        `Delete "${b.versionLabel || b.fileName}"? Any subsequent BOMs will lose this as their diff baseline.`
      )
    )
      return;
    try {
      await deleteDoc(doc(db, 'productBoms', b.id));
      logActivity({
        userId: uid,
        projectId,
        eventType: 'bom_uploaded',
        tool: 'bom_pulse',
        title: `BOM revision deleted: ${b.versionLabel || b.fileName}`,
        timestampMs: Date.now(),
      });
      await loadBoms();
    } catch (e: any) {
      console.error('[ProductBomTool] delete failed', e);
      alert(e?.message || 'Delete failed');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-xl overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Boxes size={20} className="text-slate-300" />
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/70 mb-1">
              Tool · BOM revisions & ECO change control pulse
            </p>
            <h3 className="text-lg font-black uppercase tracking-tight leading-tight">
              ECO Pulse
            </h3>
          </div>
        </div>
        {mode.kind === 'list' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadBoms}
              disabled={loading}
              className="text-[10px] font-black uppercase tracking-widest text-white/70 hover:text-white transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Reload
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setMode({ kind: 'new' })}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow"
              >
                <Plus size={12} /> BOM / ECO
              </button>
            )}
          </div>
        )}
      </div>

      {/* Layer-2 cross-check banner */}
      {crossCheck && mode.kind === 'list' && (
        <div className="px-6 pt-4">
          <CrossCheckBanner result={crossCheck} onDismiss={() => setCrossCheck(null)} />
        </div>
      )}

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
            <BomList
              boms={boms}
              loading={loading}
              error={error}
              onOpen={(b) => setMode({ kind: 'view', bomId: b.id })}
              onDelete={deleteBom}
              onUploadFirst={() => setMode({ kind: 'new' })}
              readOnly={readOnly}
            />
          </motion.div>
        ) : mode.kind === 'new' ? (
          <motion.div
            key="new"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <BomUploadForm
              projectId={projectId}
              userId={uid}
              currentGate={currentGate}
              priorBoms={boms}
              savedColumnMap={savedColumnMap}
              onSaved={async (mapping) => {
                if (mapping) await persistColumnMap(mapping);
                await loadBoms();
                setMode({ kind: 'list' });
                // Layer-2: after the BOM list reloads, check if the new upload
                // has supplier swaps that conflict with active decisions.
                // boms state isn't updated yet (setState is async), so we
                // re-read it via a functional update trick — use the setter
                // to peek at fresh state, then run the check.
                setBoms((fresh) => {
                  if (fresh.length >= 2) {
                    const diff = diffBoms(fresh[1].lines, fresh[0].lines);
                    const swapped = diff.changed
                      .filter((c) => c.kinds.includes('manufacturer'))
                      .map((c) => ({
                        internalPn:   c.after.internalPn,
                        description:  c.after.description,
                        manufacturer: c.after.manufacturer,
                        mpn:          c.after.mpn
                      }));
                    if (swapped.length > 0) {
                      checkBomVsDecisions(db, uid, projectId, swapped)
                        .then((result) => { if (result) setCrossCheck(result); })
                        .catch(() => { /* non-fatal */ });
                    }
                  }
                  return fresh; // no actual state mutation
                });
              }}
              onCancel={() => setMode({ kind: 'list' })}
            />
          </motion.div>
        ) : (
          <motion.div
            key={`view-${mode.bomId}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <BomView
              bom={boms.find((b) => b.id === mode.bomId)}
              priorBoms={boms.filter((b) => b.id !== mode.bomId)}
              projectName={projectName || ''}
              productType={productType}
              currentGate={currentGate}
              gateTargets={gateTargets}
              standards={standards}
              templateName={templateName}
              disabledItemIds={disabledItemIds}
              onBack={() => setMode({ kind: 'list' })}
              onImpactSaved={loadBoms}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ProductBomTool;

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

interface BomListProps {
  boms: ProductBom[];
  loading: boolean;
  error: string | null;
  onOpen: (b: ProductBom) => void;
  onDelete: (b: ProductBom) => void;
  onUploadFirst: () => void;
  readOnly: boolean;
}

const BomList: React.FC<BomListProps> = ({
  boms,
  loading,
  error,
  onOpen,
  onDelete,
  onUploadFirst,
  readOnly
}) => {
  if (loading) {
    return (
      <div className="px-6 py-10 flex items-center justify-center text-slate-400 text-sm gap-2">
        <Loader2 size={14} className="animate-spin" /> Loading BOMs…
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
  if (boms.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <Boxes size={32} className="mx-auto text-slate-300 mb-3" />
        <p className="text-sm text-slate-600 mb-1 font-semibold">
          No entries yet.
        </p>
        <p className="text-[11px] text-slate-400 mb-4">
          Log a BOM revision, an ECO event, or both. Each BOM upload auto-diffs against the previous one.
        </p>
        {!readOnly && (
          <button
            type="button"
            onClick={onUploadFirst}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-2 shadow"
          >
            <Plus size={12} /> Add first entry
          </button>
        )}
      </div>
    );
  }

  // Pair each BOM (except the oldest) with the next-older one for an at-a-
  // glance diff badge.
  return (
    <ul className="divide-y divide-slate-100">
      {boms.map((b, i) => {
        const baseline = boms[i + 1];
        let diffBadge: string | null = null;
        let diffTone: 'amber' | 'rose' | 'emerald' = 'emerald';
        if (baseline) {
          const d = diffBoms(baseline.lines, b.lines);
          const totalDelta = d.summary.addedCount + d.summary.removedCount + d.summary.changedCount;
          if (totalDelta === 0) {
            diffBadge = 'no change';
            diffTone = 'emerald';
          } else {
            const parts = [];
            if (d.summary.addedCount) parts.push(`+${d.summary.addedCount} added`);
            if (d.summary.removedCount) parts.push(`-${d.summary.removedCount} removed`);
            if (d.summary.changedCount) parts.push(`${d.summary.changedCount} changed`);
            diffBadge = parts.join(' · ');
            diffTone = d.summary.supplierSwapCount > 0 ? 'rose' : 'amber';
          }
        }
        const toneCls =
          diffTone === 'rose'
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : diffTone === 'amber'
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-emerald-50 text-emerald-700 border-emerald-200';
        const hasAi = Boolean(b.impactAnalysis);
        return (
          <li
            key={b.id}
            className="px-6 py-4 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => onOpen(b)}
              className="flex-1 text-left"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500 tabular-nums">
                  {formatEffectiveDate(b.effectiveDateMs || b.uploadedAtMs)}
                </span>
                {b.uploadedAtGate && (
                  <span className="inline-flex items-center border border-slate-300 bg-slate-50 text-slate-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">
                    {b.uploadedAtGate}
                  </span>
                )}
                {diffBadge && (
                  <span
                    className={`inline-flex items-center border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${toneCls}`}
                  >
                    {diffBadge}
                  </span>
                )}
                {hasAi && (
                  <span className="inline-flex items-center gap-1 border border-violet-200 bg-violet-50 text-violet-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">
                    <Sparkles size={9} /> AI impact
                  </span>
                )}
                {b.source && b.source !== 'upload' && (
                  <span className="inline-flex items-center border border-sky-200 bg-sky-50 text-sky-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">
                    {b.source}
                  </span>
                )}
                {b.eco && (
                  <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                    b.eco.blocking
                      ? 'border-rose-300 bg-rose-50 text-rose-600'
                      : b.eco.status === 'implemented'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-600'
                  }`}>
                    <GitBranch size={9} />
                    {b.eco.ref}{b.eco.blocking ? ' · Blocking' : ` · ${ECO_STATUS_LABELS[b.eco.status]}`}
                  </span>
                )}
              </div>
              <p className="text-sm font-bold text-slate-900 mt-1 truncate">
                {b.versionLabel || b.fileName}
              </p>
              {b.reasonForChange && (
                <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2 italic">
                  {b.reasonForChange}
                </p>
              )}
              <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <Hash size={11} /> {b.totalLines} lines
                </span>
                <span className="inline-flex items-center gap-1 truncate">
                  <FileText size={11} /> {b.fileName}
                </span>
                <span className="text-slate-400 text-[10px]">
                  uploaded {formatUploadedAt(b.uploadedAtMs)}
                </span>
              </p>
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onDelete(b)}
                title="Delete this BOM revision"
                className="text-slate-400 hover:text-rose-600 transition-colors p-1"
              >
                <Trash2 size={14} />
              </button>
            )}
            </div>
            {!readOnly && (
              <div className="mt-2">
                <PushToOpenItemsInline
                  db={db}
                  userId={b.userId}
                  projectId={b.projectId}
                  sourceTool="bom"
                  sourceDocId={b.id}
                  initialTitle={b.versionLabel || b.fileName || ''}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

// ---------------------------------------------------------------------------
// Upload form — file pick → mapping confirm → review → save
// ---------------------------------------------------------------------------

interface BomUploadFormProps {
  projectId: string;
  userId: string;
  currentGate?: ProductGate;
  priorBoms: ProductBom[];
  savedColumnMap?: ColumnMapping;
  onSaved: (learnedMapping: ColumnMapping | null) => void;
  onCancel: () => void;
}

const BomUploadForm: React.FC<BomUploadFormProps> = ({
  projectId,
  userId,
  currentGate,
  priorBoms,
  savedColumnMap,
  onSaved,
  onCancel
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [versionLabel, setVersionLabel] = useState('');
  // Effective date defaults to today; user can backdate for ECO-effective uploads.
  const [effectiveDate, setEffectiveDate] = useState<string>(todayDateInputValue());
  const [reasonForChange, setReasonForChange] = useState('');
  // ECO context — optional, collapsible
  const [ecoExpanded, setEcoExpanded] = useState(false);
  const [ecoRef, setEcoRef]         = useState('');
  const [ecoTitle, setEcoTitle]     = useState('');
  const [ecoStatus, setEcoStatus]   = useState<EcoStatus>('open');
  const [ecoArea, setEcoArea]       = useState<EcoArea>('bom');
  const [ecoBlocking, setEcoBlocking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Computed: lines built from the current mapping + raw rows. Re-computed
  // whenever the user tweaks the mapping in the panel.
  const lines: BomLine[] = useMemo(() => {
    if (!parseResult) return [];
    return applyMapping(parseResult.rawRows, mapping);
  }, [parseResult, mapping]);

  // Diff against latest prior BOM, if any. Pure preview — not persisted yet.
  const latestPrior = priorBoms[0];
  const previewDiff: BomDiff | null = useMemo(() => {
    if (!latestPrior || lines.length === 0) return null;
    return diffBoms(latestPrior.lines, lines);
  }, [latestPrior, lines]);

  const onPickFile = async (f: File) => {
    setFile(f);
    setParseResult(null);
    setParseError(null);
    setParsing(true);
    try {
      const result = await parseBomFile(f);
      setParseResult(result);
      // Seed mapping: prefer saved project mapping if it still resolves to
      // valid headers in this file; otherwise fall back to the heuristic
      // suggestion. This is how the tool "learns" — second-and-subsequent
      // uploads silently apply what the user previously confirmed.
      const seed = applyPriorOrHeuristic(result, savedColumnMap);
      setMapping(seed);
    } catch (e: any) {
      console.error('[ProductBomTool] parse failed', e);
      setParseError(e?.message || 'Failed to parse file.');
    } finally {
      setParsing(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) onPickFile(f);
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onPickFile(f);
  };

  const hasBom    = lines.length > 0;
  const hasEco    = ecoExpanded && ecoRef.trim().length > 0;
  const canSave   = hasBom || hasEco || reasonForChange.trim().length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const ecoPayload: EcoContext | undefined =
        hasEco
          ? {
              ref:      ecoRef.slice(0, ECO_REF_MAX).trim(),
              title:    ecoTitle.slice(0, ECO_TITLE_MAX).trim(),
              status:   ecoStatus,
              area:     ecoArea,
              blocking: ecoBlocking,
            }
          : undefined;

      const label = versionLabel.slice(0, VERSION_MAX).trim()
        || (file ? file.name.replace(/\.(xlsx|xls|csv)$/i, '') : '')
        || (ecoPayload ? ecoPayload.ref : 'Manual entry');

      const payload: Omit<ProductBom, 'id'> = {
        userId,
        projectId,
        fileName:        file ? file.name : '',
        versionLabel:    label,
        effectiveDateMs: msFromDateInputValue(effectiveDate),
        reasonForChange: reasonForChange.slice(0, REASON_MAX).trim(),
        uploadedAtMs:    Date.now(),
        uploadedAtGate:  currentGate,
        source:          file ? 'upload' : 'manual',
        columnMap:       mapping,
        lines,
        totalLines:      lines.length,
        ...(ecoPayload ? { eco: ecoPayload } : {}),
      };
      await addDoc(collection(db, 'productBoms'), {
        ...stripUndefined(payload),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      // Log activity (fire-and-forget)
      const ecoDetail = ecoPayload
        ? `${ecoPayload.ref} · ${ECO_STATUS_LABELS[ecoPayload.status]}${ecoPayload.blocking ? ' · ⚠ BLOCKING' : ''}`
        : null;
      const eventType = ecoPayload ? 'eco_flagged' : 'bom_uploaded';
      logActivity({
        userId,
        projectId,
        eventType,
        tool: 'bom_pulse',
        title: ecoPayload
          ? (hasBom ? `BOM uploaded: ${label} [${ecoPayload.ref}]` : `ECO logged: ${ecoPayload.ref}`)
          : `BOM uploaded: ${label}`,
        detail: ecoDetail
          ?? (payload.reasonForChange
            ? payload.reasonForChange.slice(0, 120)
            : `${lines.length} line${lines.length !== 1 ? 's' : ''} · ${file?.name ?? ''}`),
        metadata: {
          lineCount: lines.length,
          gate: currentGate ?? '',
          ...(ecoPayload ? {
            ecoRef:      ecoPayload.ref,
            ecoStatus:   ecoPayload.status,
            ecoBlocking: ecoPayload.blocking,
          } : {}),
        },
        timestampMs: Date.now(),
      });
      onSaved(mapping);
    } catch (e: any) {
      console.error('[ProductBomTool] save failed', e);
      setSaveError(e?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-6 py-6 space-y-6">
      {/* Back + baseline hint */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 flex items-center gap-1"
        >
          <ArrowLeft size={12} /> Back to list
        </button>
        {latestPrior && (
          <p className="text-[11px] text-slate-500">
            Previous BOM: {latestPrior.versionLabel || latestPrior.fileName} ({latestPrior.totalLines} lines)
          </p>
        )}
      </div>

      {/* Metadata — always visible, no file trigger */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Version Label
          </span>
          <input
            type="text"
            value={versionLabel}
            maxLength={VERSION_MAX}
            onChange={(e) => setVersionLabel(e.target.value)}
            placeholder="e.g. Rev A · Pre-CDR · EVT-2"
            className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Effective Date
          </span>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <span className="text-[10px] text-slate-400">
            When this change goes into effect (defaults to today).
          </span>
        </label>
        <label className="block md:col-span-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Reason for Change
          </span>
          <textarea
            value={reasonForChange}
            maxLength={REASON_MAX}
            onChange={(e) => setReasonForChange(e.target.value)}
            placeholder="ECO-1234 · supplier swap due to lead-time risk on STM32F407 / FUSA non-conformance fix / cost reduction on R-value passives, etc."
            rows={2}
            className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <div className="flex justify-between items-center mt-0.5">
            <span className="text-[10px] text-slate-400">
              Threaded into the AI Impact prompt — be specific.
            </span>
            <span className="text-[10px] text-slate-400 tabular-nums">
              {reasonForChange.length}/{REASON_MAX}
            </span>
          </div>
        </label>
      </div>

      {/* ECO / Change Control context — always visible, collapsible */}
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <button
          type="button"
          onClick={() => setEcoExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <GitBranch size={13} className={ecoExpanded && ecoRef.trim() ? 'text-amber-500' : 'text-slate-400'} />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
              ECO / Change Control
            </span>
            {ecoRef.trim() && (
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                ecoBlocking
                  ? 'bg-rose-100 text-rose-600 border border-rose-200'
                  : 'bg-amber-50 text-amber-600 border border-amber-200'
              }`}>
                {ecoRef.trim()}{ecoBlocking ? ' · Blocking' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            {!ecoExpanded && <span>Optional — log ECO without uploading a file</span>}
            {ecoExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </div>
        </button>
        {ecoExpanded && (
          <div className="px-4 py-4 space-y-4 bg-white">
            <p className="text-[10px] text-slate-400">
              BridgeOps doesn't manage ECOs — your PLM does. Log the ECO reference here so it becomes
              a project event and the AI can flag design-stability risk at the current gate.
              A BOM file attachment is not required.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  ECO Reference <span className="text-slate-400 font-normal normal-case">(from PLM)</span>
                </span>
                <input
                  type="text"
                  value={ecoRef}
                  maxLength={ECO_REF_MAX}
                  onChange={(e) => setEcoRef(e.target.value)}
                  placeholder="e.g. ECO-2024-123"
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Status
                </span>
                <select
                  value={ecoStatus}
                  onChange={(e) => setEcoStatus(e.target.value as EcoStatus)}
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                >
                  {(Object.keys(ECO_STATUS_LABELS) as EcoStatus[]).map((s) => (
                    <option key={s} value={s}>{ECO_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  ECO Title / Summary
                </span>
                <input
                  type="text"
                  value={ecoTitle}
                  maxLength={ECO_TITLE_MAX}
                  onChange={(e) => setEcoTitle(e.target.value)}
                  placeholder="Brief description of what the ECO changes"
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Area Affected
                </span>
                <select
                  value={ecoArea}
                  onChange={(e) => setEcoArea(e.target.value as EcoArea)}
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                >
                  {(Object.keys(ECO_AREA_LABELS) as EcoArea[]).map((a) => (
                    <option key={a} value={a}>{ECO_AREA_LABELS[a]}</option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-3 pt-5">
                <button
                  type="button"
                  onClick={() => setEcoBlocking((v) => !v)}
                  className={`flex items-center gap-2 px-3 py-2 rounded border text-[10px] font-black uppercase tracking-widest transition-colors ${
                    ecoBlocking
                      ? 'bg-rose-50 border-rose-300 text-rose-600'
                      : 'bg-white border-slate-300 text-slate-500 hover:border-slate-400'
                  }`}
                >
                  <ShieldCheck size={12} />
                  {ecoBlocking ? 'Blocking gate ✓' : 'Mark as blocking gate'}
                </button>
                <span className="text-[10px] text-slate-400">
                  Flags the ECO as blocking a gate deliverable
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* BOM File — optional attachment */}
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload size={13} className={file ? 'text-blue-500' : 'text-slate-400'} />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
              Attach BOM File
            </span>
            {file && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">
                {file.name} · {lines.length} lines
              </span>
            )}
          </div>
          <span className="text-[10px] text-slate-400">Optional</span>
        </div>
        <div className="px-4 py-4 bg-white space-y-3">
          {!parseResult ? (
            <div
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={handleDrop}
              className="border-2 border-dashed border-slate-300 rounded-md p-6 text-center hover:border-blue-400 transition-colors cursor-pointer bg-slate-50"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={20} className="mx-auto text-slate-400 mb-1" />
              <p className="text-sm text-slate-600 font-medium">Drop a BOM file here, or click to browse</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Accepts .xlsx, .xls, .csv (≤10MB)</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleSelect}
                className="hidden"
              />
            </div>
          ) : (
            <div className="text-[11px] text-slate-500 flex items-center gap-2">
              <FileText size={13} className="text-blue-400" />
              <span className="font-mono">{file?.name}</span>
              <span>· {lines.length} lines parsed</span>
              <button
                type="button"
                onClick={() => { setFile(null); setParseResult(null); setParseError(null); setMapping({}); }}
                className="ml-auto text-slate-400 hover:text-rose-500 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {parsing && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Parsing {file?.name}…
            </div>
          )}
          {parseError && (
            <div className="flex items-start gap-2 text-sm text-rose-600">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{parseError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Column mapping panel — only when file parsed */}
      {parseResult && (
        <ColumnMappingPanel
          headers={parseResult.headers}
          mapping={mapping}
          warnings={parseResult.warnings}
          onChange={setMapping}
        />
      )}

      {/* Preview diff — only when file parsed + prior exists */}
      {previewDiff && (
        <PreviewDiffPanel
          diff={previewDiff}
          baselineLabel={latestPrior?.versionLabel || latestPrior?.fileName || 'baseline'}
        />
      )}

      {/* Save controls */}
      {saveError && (
        <div className="flex items-start gap-2 text-sm text-rose-600">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{saveError}</span>
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-900"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !canSave}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {hasBom ? 'Save BOM' : hasEco ? 'Log ECO Event' : 'Save'}
        </button>
      </div>
    </div>
  );
};

function applyPriorOrHeuristic(
  pr: ParseResult,
  saved: ColumnMapping | undefined
): ColumnMapping {
  if (!saved) return pr.suggestedMapping;
  // Only keep saved-mapping fields whose header still exists in this file.
  const headerSet = new Set(pr.headers);
  const kept: ColumnMapping = {};
  (Object.keys(saved) as (keyof ColumnMapping)[]).forEach((k) => {
    const v = saved[k];
    if (v && headerSet.has(v)) kept[k] = v;
  });
  // Fill any missing fields from the heuristic suggestion.
  (Object.keys(pr.suggestedMapping) as (keyof ColumnMapping)[]).forEach((k) => {
    if (!kept[k]) kept[k] = pr.suggestedMapping[k];
  });
  return kept;
}

// Strip undefined keys before writing to Firestore (updateDoc / addDoc reject
// them). Same defense pattern as the rest of the codebase.
function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item) ? stripUndefined(item) : item
      );
    } else if (v && typeof v === 'object' && !(v instanceof Date)) {
      out[k] = stripUndefined(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Column mapping panel — user confirms / overrides which source column maps
// to which semantic field. This is the "learning" surface.
// ---------------------------------------------------------------------------

interface ColumnMappingPanelProps {
  headers: string[];
  mapping: ColumnMapping;
  warnings: string[];
  onChange: (m: ColumnMapping) => void;
}

const FIELD_LABELS: { key: keyof ColumnMapping; label: string; hint: string }[] = [
  { key: 'bomLevel', label: 'BOM Level', hint: 'Indent level for multi-level BOMs (1 = top, 2 = sub-assembly…)' },
  { key: 'internalPn', label: 'Internal / House PN', hint: 'Your company\'s internal part number (preferred diff key)' },
  { key: 'description', label: 'Description', hint: 'Free-text part description' },
  { key: 'qty', label: 'BOM Qty', hint: 'Quantity per assembly' },
  { key: 'mpn', label: 'MPN', hint: 'Manufacturer Part Number (if applicable)' },
  { key: 'manufacturer', label: 'Manufacturer', hint: 'Vendor / brand name (if applicable)' },
  { key: 'refDes', label: 'Ref Des', hint: 'Reference designators, e.g. "U1, U2"' },
  { key: 'unitCost', label: 'Unit Cost', hint: 'Cost per unit (USD assumed)' },
  { key: 'package', label: 'Package / Footprint', hint: 'e.g. 0603, LQFP-100' }
];

const ColumnMappingPanel: React.FC<ColumnMappingPanelProps> = ({
  headers,
  mapping,
  warnings,
  onChange
}) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-slate-200 rounded">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center justify-between bg-slate-50 hover:bg-slate-100"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-700">
            Column Mapping
          </span>
          <span className="text-[10px] text-slate-500">
            ({Object.values(mapping).filter(Boolean).length} of {FIELD_LABELS.length} mapped)
          </span>
        </div>
        {warnings.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-700">
            <AlertTriangle size={11} /> {warnings.length} note{warnings.length === 1 ? '' : 's'}
          </span>
        )}
      </button>
      {open && (
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-slate-500">
            We auto-detected the mapping from your column headers. Confirm or pick
            different columns below — your choice is saved on the project so future
            uploads apply silently.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FIELD_LABELS.map(({ key, label, hint }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  {label}{' '}
                  {key === 'internalPn' && (
                    <span className="ml-1 text-[9px] font-bold text-blue-700">
                      preferred
                    </span>
                  )}
                  {(key === 'qty' || key === 'internalPn' || key === 'description') && (
                    <span className="ml-1 text-[9px] font-bold text-rose-600">
                      required
                    </span>
                  )}
                </span>
                <select
                  value={mapping[key] || ''}
                  onChange={(e) => {
                    const v = e.target.value || undefined;
                    onChange({ ...mapping, [key]: v });
                  }}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                >
                  <option value="">— (not mapped)</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-400">{hint}</span>
              </label>
            ))}
          </div>
          {warnings.length > 0 && (
            <ul className="border-t border-slate-100 pt-3 space-y-1">
              {warnings.map((w, i) => (
                <li
                  key={i}
                  className="text-[11px] text-amber-700 flex items-start gap-1.5"
                >
                  <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" /> {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Diff preview / panel used on both upload + view screens
// ---------------------------------------------------------------------------

interface PreviewDiffPanelProps {
  diff: BomDiff;
  baselineLabel: string;
}

const PreviewDiffPanel: React.FC<PreviewDiffPanelProps> = ({ diff, baselineLabel }) => {
  const { added, removed, changed, summary } = diff;
  const totalChanges = added.length + removed.length + changed.length;
  return (
    <div className="border border-slate-200 rounded">
      {/* Summary badges */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-700">
            Red Lines vs. {baselineLabel}
          </span>
          <div className="flex items-center gap-2 text-[10px] font-bold">
            <span className={`inline-flex items-center px-2 py-0.5 rounded ${summary.addedCount ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
              +{summary.addedCount} added
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded ${summary.removedCount ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-400'}`}>
              -{summary.removedCount} removed
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded ${summary.changedCount ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'}`}>
              {summary.changedCount} changed
            </span>
            {summary.supplierSwapCount > 0 && (
              <span className="inline-flex items-center gap-1 bg-rose-50 border border-rose-200 text-rose-700 px-2 py-0.5 rounded">
                <Building2 size={10} /> {summary.supplierSwapCount} supplier swap{summary.supplierSwapCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
        {(Math.abs(summary.qtyDelta) > 0 || Math.abs(summary.costDelta) >= 0.01) && (
          <div className="mt-2 text-[10px] text-slate-500 flex items-center gap-4 tabular-nums">
            {Math.abs(summary.qtyDelta) > 0 && (
              <span>Qty Δ {summary.qtyDelta >= 0 ? '+' : ''}{summary.qtyDelta}</span>
            )}
            {Math.abs(summary.costDelta) >= 0.01 && (
              <span>Cost/assy Δ {summary.costDelta >= 0 ? '+$' : '-$'}{Math.abs(summary.costDelta).toFixed(2)}</span>
            )}
          </div>
        )}
      </div>

      {totalChanges === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">
          No detected changes vs. {baselineLabel}.
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
          {/* Changed items first — the "red lines" */}
          {changed.map((c, i) => (
            <ChangedRow key={`c-${i}`} change={c} />
          ))}
          {/* Added / removed only shown when they actually exist */}
          {added.map((l, i) => (
            <SimpleRow key={`a-${i}`} kind="added" line={l} />
          ))}
          {removed.map((l, i) => (
            <SimpleRow key={`r-${i}`} kind="removed" line={l} />
          ))}
        </div>
      )}
    </div>
  );
};

/** Returns a human-readable before→after string for a given ChangeKind. */
function attrDiff(kind: ChangeKind, before: BomLine, after: BomLine): { label: string; from: string; to: string } | null {
  switch (kind) {
    case 'qty':
      return { label: 'BOM Qty', from: String(before.qty), to: String(after.qty) };
    case 'mpn':
      return { label: 'MPN', from: before.mpn ?? '—', to: after.mpn ?? '—' };
    case 'manufacturer':
      return { label: 'Manufacturer', from: before.manufacturer ?? '—', to: after.manufacturer ?? '—' };
    case 'description':
      return { label: 'Description', from: before.description ?? '—', to: after.description ?? '—' };
    case 'cost':
      return {
        label: 'Unit cost',
        from: before.unitCost != null ? `$${before.unitCost}` : '—',
        to: after.unitCost != null ? `$${after.unitCost}` : '—'
      };
    case 'refDes':
      return { label: 'RefDes', from: before.refDes ?? '—', to: after.refDes ?? '—' };
    case 'package':
      return { label: 'Package', from: before.package ?? '—', to: after.package ?? '—' };
    case 'level':
      return {
        label: 'BOM Level',
        from: before.bomLevel != null ? `L${before.bomLevel}` : '—',
        to: after.bomLevel != null ? `L${after.bomLevel}` : '—'
      };
    case 'rev':
      return { label: 'Revision', from: before.rev ?? '—', to: after.rev ?? '—' };
    default:
      return null;
  }
}

const ChangedRow: React.FC<{
  change: BomDiff['changed'][number];
}> = ({ change }) => {
  const { before, after, kinds } = change;
  const diffs = kinds.map((k) => attrDiff(k, before, after)).filter((d): d is NonNullable<typeof d> => d !== null);
  return (
    <div className="px-4 py-3 text-[12px]">
      {/* Part identifier */}
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest flex-shrink-0">
          Δ changed
        </span>
        {after.bomLevel != null && (
          <span className="inline-flex items-center bg-slate-100 text-slate-600 px-1 rounded text-[9px] font-bold tabular-nums">
            L{after.bomLevel}
          </span>
        )}
        <span className="font-semibold text-slate-900 truncate">{shortRef(after)}</span>
        {after.description && after.description !== shortRef(after) && (
          <span className="text-slate-500 truncate hidden sm:inline">{after.description}</span>
        )}
      </div>
      {/* Attribute-level before → after (Red Lines) */}
      <div className="ml-1 space-y-1">
        {diffs.map((d) => (
          <div key={d.label} className="flex items-baseline gap-2 text-[11px]">
            <span className="text-slate-500 w-24 flex-shrink-0 font-medium">{d.label}</span>
            <span className="line-through text-rose-500 font-mono">{d.from}</span>
            <span className="text-slate-400 text-[10px]">→</span>
            <span className="text-emerald-700 font-mono font-semibold">{d.to}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const SimpleRow: React.FC<{
  kind: 'added' | 'removed';
  line: BomLine;
}> = ({ kind, line }) => {
  const cls =
    kind === 'added'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-rose-100 text-rose-700';
  const sign = kind === 'added' ? '+' : '−';
  return (
    <div className="px-4 py-2 text-[12px] flex items-start gap-3">
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${cls} flex-shrink-0`}
      >
        {sign}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-slate-900 truncate">
          {line.bomLevel != null && (
            <span className="inline-flex items-center bg-slate-100 text-slate-600 px-1 mr-1 rounded text-[9px] font-bold tabular-nums">
              L{line.bomLevel}
            </span>
          )}
          {shortRef(line)}
        </div>
        <div className="text-[11px] text-slate-500 truncate">
          {line.description ? `${line.description} · ` : ''}
          {line.manufacturer ? `${line.manufacturer} · ` : ''}qty {line.qty}
          {line.unitCost != null ? ` · $${line.unitCost}` : ''}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// View saved BOM — shows lines + diff vs. previous + AI Impact CTA / panel
// ---------------------------------------------------------------------------

interface BomViewProps {
  bom: ProductBom | undefined;
  priorBoms: ProductBom[];   // all OTHER boms, in date-desc order
  projectName: string;
  productType?: string;
  currentGate?: ProductGate;
  gateTargets?: Partial<Record<ProductGate, string>>;
  standards?: string[];
  templateName?: string;
  disabledItemIds?: string[];
  onBack: () => void;
  onImpactSaved: () => Promise<void> | void;
}

const BomView: React.FC<BomViewProps> = ({
  bom,
  priorBoms,
  projectName,
  productType,
  currentGate,
  gateTargets,
  standards,
  templateName,
  disabledItemIds,
  onBack,
  onImpactSaved
}) => {
  // The natural baseline = the BOM uploaded JUST BEFORE this one. Since
  // priorBoms excludes this BOM and is ordered date-desc, find the first
  // one with uploadedAtMs < this one's.
  const baseline = useMemo(() => {
    if (!bom) return undefined;
    return priorBoms.find((b) => b.uploadedAtMs < bom.uploadedAtMs);
  }, [bom, priorBoms]);

  // Let user choose a different baseline (ad-hoc compare).
  const [baselineOverrideId, setBaselineOverrideId] = useState<string>('');
  const effectiveBaseline = useMemo(() => {
    if (baselineOverrideId) {
      return priorBoms.find((b) => b.id === baselineOverrideId);
    }
    return baseline;
  }, [baselineOverrideId, baseline, priorBoms]);

  const liveDiff = useMemo(() => {
    if (!bom || !effectiveBaseline) return null;
    return diffBoms(effectiveBaseline.lines, bom.lines);
  }, [bom, effectiveBaseline]);

  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // Cache results across baseline-overrides without losing the saved one
  // tied to the natural baseline. The saved impactAnalysis stays sticky.
  const [adhocResult, setAdhocResult] = useState<BomImpactAnalysis | null>(null);
  const [adhocBaselineId, setAdhocBaselineId] = useState<string>('');

  // Which analysis to show right now: the ad-hoc one if it matches the
  // current baseline, otherwise the saved one (if its baseline matches).
  const displayedAnalysis: BomImpactAnalysis | undefined = useMemo(() => {
    if (!bom) return undefined;
    if (adhocResult && adhocBaselineId && adhocBaselineId === effectiveBaseline?.id) {
      return adhocResult;
    }
    if (bom.impactAnalysis && bom.impactAnalysis.baselineBomId === effectiveBaseline?.id) {
      return bom.impactAnalysis;
    }
    return undefined;
  }, [adhocResult, adhocBaselineId, bom, effectiveBaseline]);

  if (!bom) {
    return (
      <div className="px-6 py-10 flex items-center gap-2 text-slate-500 text-sm">
        <AlertTriangle size={14} /> BOM not found — it may have just been deleted.
      </div>
    );
  }

  const runAi = async () => {
    if (!bom || !liveDiff || !effectiveBaseline) return;
    setAiRunning(true);
    setAiError(null);
    try {
      const isMultiLevel = bom.lines.some((l) => typeof l.bomLevel === 'number');
      const result = await analyzeBomImpact({
        projectName,
        productType,
        currentGate,
        gateTargets,
        standards,
        templateName,
        disabledItemIds,
        baselineLabel: effectiveBaseline.versionLabel || effectiveBaseline.fileName,
        currentLabel: bom.versionLabel || bom.fileName,
        effectiveDateMs: bom.effectiveDateMs,
        reasonForChange: bom.reasonForChange,
        isMultiLevel,
        diff: liveDiff
      });
      setAdhocResult(result);
      setAdhocBaselineId(effectiveBaseline.id);
      // Log AI analysis event (fire-and-forget)
      if (bom) {
        logActivity({
          userId: bom.userId,
          projectId: bom.projectId,
          eventType: 'bom_impact_analyzed',
          tool: 'bom_pulse',
          title: `AI Impact analyzed: ${bom.versionLabel || bom.fileName}`,
          detail: result.topActions?.length
            ? `Top action: ${result.topActions[0]?.title?.slice(0, 100)}`
            : result.affectedRampItems?.length
              ? `${result.affectedRampItems.length} RAMP items affected`
              : undefined,
          metadata: {
            affectedCount: result.affectedRampItems?.length ?? 0,
            newRisksCount: result.newRisks?.length ?? 0,
          },
          timestampMs: Date.now(),
        });
      }
      // If this matches the natural baseline, also persist on the BOM doc
      // so it's surfaced on reload + listed in the BOM row badge.
      if (effectiveBaseline.id === baseline?.id) {
        const persistable: SavedImpactAnalysis = {
          baselineBomId: effectiveBaseline.id,
          baselineLabel: effectiveBaseline.versionLabel || effectiveBaseline.fileName,
          generatedAtMs: result.generatedAt,
          narrative: result.narrative,
          affectedRampItems: result.affectedRampItems,
          newRisks: result.newRisks,
          topActions: result.topActions
        };
        try {
          await updateDoc(doc(db, 'productBoms', bom.id), {
            impactAnalysis: persistable,
            updatedAt: serverTimestamp()
          });
          await onImpactSaved();
        } catch (persistErr: any) {
          // Non-fatal — the user still has the analysis in-memory.
          console.warn('[ProductBomTool] persist impactAnalysis failed', persistErr);
        }
      }
    } catch (e: any) {
      console.error('[ProductBomTool] AI impact failed', e);
      setAiError(e?.message || 'AI analysis failed');
    } finally {
      setAiRunning(false);
    }
  };

  return (
    <div className="px-6 py-6 space-y-6">
      {/* Back + meta */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 flex items-center gap-1"
        >
          <ArrowLeft size={12} /> Back to list
        </button>
        <div className="text-[11px] text-slate-500 flex items-center gap-3 flex-wrap">
          <span className="font-bold text-slate-700">
            Effective {formatEffectiveDate(bom.effectiveDateMs || bom.uploadedAtMs)}
          </span>
          {bom.uploadedAtGate && (
            <span className="inline-flex items-center border border-slate-300 bg-slate-50 text-slate-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">
              at gate {bom.uploadedAtGate}
            </span>
          )}
          {bom.source && bom.source !== 'upload' && (
            <span className="inline-flex items-center border border-sky-200 bg-sky-50 text-sky-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">
              source: {bom.source}
            </span>
          )}
          <span className="text-slate-400">{bom.totalLines} lines</span>
          <span className="text-slate-400 text-[10px]">
            uploaded {formatUploadedAt(bom.uploadedAtMs)}
          </span>
        </div>
      </div>

      {/* Title block */}
      <div>
        <h4 className="text-xl font-black text-slate-900">
          {bom.versionLabel || bom.fileName}
        </h4>
        {bom.reasonForChange && (
          <div className="mt-2 border-l-2 border-amber-300 bg-amber-50 px-3 py-2 rounded-r">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-0.5">
              Reason for change
            </p>
            <p className="text-sm text-slate-700 whitespace-pre-line">{bom.reasonForChange}</p>
          </div>
        )}
        {bom.eco && (
          <div className={`mt-2 border-l-2 px-3 py-2 rounded-r flex items-start gap-3 ${
            bom.eco.blocking
              ? 'border-rose-400 bg-rose-50'
              : bom.eco.status === 'implemented'
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-amber-300 bg-amber-50'
          }`}>
            <GitBranch size={14} className={
              bom.eco.blocking ? 'text-rose-500 mt-0.5 flex-shrink-0'
              : bom.eco.status === 'implemented' ? 'text-emerald-600 mt-0.5 flex-shrink-0'
              : 'text-amber-600 mt-0.5 flex-shrink-0'
            } />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  ECO / Change Control
                </span>
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                  bom.eco.blocking
                    ? 'border-rose-300 bg-rose-100 text-rose-600'
                    : bom.eco.status === 'implemented'
                      ? 'border-emerald-200 bg-emerald-100 text-emerald-700'
                      : 'border-amber-200 bg-amber-100 text-amber-600'
                }`}>
                  {ECO_STATUS_LABELS[bom.eco.status]}
                </span>
                {bom.eco.blocking && (
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border border-rose-400 bg-rose-100 text-rose-700">
                    ⚠ Blocking gate
                  </span>
                )}
              </div>
              <p className="text-sm font-bold text-slate-800 mt-0.5">
                {bom.eco.ref}
                {bom.eco.title && <span className="font-normal text-slate-600"> — {bom.eco.title}</span>}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Area: {ECO_AREA_LABELS[bom.eco.area]}
              </p>
            </div>
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-1 font-mono">{bom.fileName}</p>
      </div>

      {/* Baseline picker (only if there are priors) */}
      {priorBoms.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Compare against:
          </span>
          <select
            value={baselineOverrideId}
            onChange={(e) => {
              setBaselineOverrideId(e.target.value);
              setAdhocResult(null);
              setAdhocBaselineId('');
            }}
            className="border border-slate-300 rounded px-2 py-1 text-sm"
          >
            <option value="">
              Previous BOM ({baseline ? baseline.versionLabel || baseline.fileName : 'none'})
            </option>
            {priorBoms.map((b) => (
              <option key={b.id} value={b.id}>
                {b.versionLabel || b.fileName} ({formatUploadedAt(b.uploadedAtMs)})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Diff (live) */}
      {liveDiff && effectiveBaseline ? (
        <PreviewDiffPanel
          diff={liveDiff}
          baselineLabel={effectiveBaseline.versionLabel || effectiveBaseline.fileName}
        />
      ) : (
        <div className="border border-slate-200 rounded px-6 py-8 text-center text-sm text-slate-500">
          {priorBoms.length === 0
            ? 'This is the baseline BOM. The next upload will diff against it.'
            : 'No baseline selected.'}
        </div>
      )}

      {/* AI Impact */}
      {liveDiff && liveDiff.summary.totalAfter > 0 && effectiveBaseline && (
        <div className="border border-slate-200 rounded">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-violet-600" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-700">
                AI Impact Analysis
              </span>
              {displayedAnalysis && (
                <span className="text-[10px] text-slate-500">
                  generated {formatUploadedAt(
                    'generatedAt' in displayedAnalysis
                      ? (displayedAnalysis as BomImpactAnalysis).generatedAt
                      : (displayedAnalysis as SavedImpactAnalysis).generatedAtMs
                  )}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={runAi}
              disabled={
                aiRunning ||
                liveDiff.summary.addedCount + liveDiff.summary.removedCount + liveDiff.summary.changedCount === 0
              }
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-1.5 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow"
            >
              {aiRunning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {displayedAnalysis ? 'Re-analyze' : 'Analyze Impact'}
            </button>
          </div>
          <div className="p-4 space-y-4">
            {aiError && (
              <div className="flex items-start gap-2 text-sm text-rose-600">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{aiError}</span>
              </div>
            )}
            {!displayedAnalysis && !aiRunning && !aiError && (
              <p className="text-[11px] text-slate-500">
                Click <span className="font-semibold text-violet-700">Analyze Impact</span> to
                run an AI assessment of how this BOM delta affects readiness, what new risks
                may emerge, and the top recommended actions.
              </p>
            )}
            {displayedAnalysis && (
              <ImpactPanel analysis={displayedAnalysis} />
            )}
          </div>
        </div>
      )}

      {/* Lines preview (collapsible) */}
      <LinesPanel lines={bom.lines} />
    </div>
  );
};

const ImpactPanel: React.FC<{
  analysis: BomImpactAnalysis | SavedImpactAnalysis;
}> = ({ analysis }) => {
  return (
    <div className="space-y-4">
      {analysis.affectedRampItems && analysis.affectedRampItems.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
            Readiness items affected
          </p>
          <ul className="space-y-1">
            {analysis.affectedRampItems.map((a, i) => (
              <li
                key={`${a.rampItemId}-${i}`}
                className="border-l-2 pl-3 py-1"
                style={{
                  borderColor:
                    a.severity === 'high'
                      ? '#e11d48'
                      : a.severity === 'medium'
                        ? '#f59e0b'
                        : '#0ea5e9'
                }}
              >
                <div className="text-sm font-semibold text-slate-900">
                  {a.rampItemTitle}
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    {a.severity}
                  </span>
                </div>
                <p className="text-[12px] text-slate-600">{a.rationale}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.newRisks && analysis.newRisks.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
            New risks
          </p>
          <ul className="space-y-1">
            {analysis.newRisks.map((r, i) => (
              <li
                key={i}
                className="text-sm text-slate-700 flex items-start gap-2"
              >
                <span
                  className={`inline-flex flex-shrink-0 items-center px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                    r.severity === 'high'
                      ? 'bg-rose-100 text-rose-700'
                      : r.severity === 'medium'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-sky-100 text-sky-700'
                  }`}
                >
                  {r.severity}
                </span>
                <div>
                  <span className="font-semibold">{r.flag}</span>
                  <span className="text-slate-500 ml-1 text-[12px]">— {r.source}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.topActions && analysis.topActions.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
            Top actions
          </p>
          <ol className="space-y-1 list-decimal list-inside">
            {analysis.topActions.map((a, i) => (
              <li key={i} className="text-sm text-slate-700">
                <span className="font-semibold">{a.title}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-2">
                  {a.impact}
                </span>
                <p className="text-[12px] text-slate-600 ml-5">{a.rationale}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
};

const LinesPanel: React.FC<{ lines: BomLine[] }> = ({ lines }) => {
  const [open, setOpen] = useState(false);
  const hasLevels = lines.some((l) => typeof l.bomLevel === 'number');
  const maxLevel = hasLevels ? Math.max(...lines.map((l) => l.bomLevel || 1)) : 1;
  return (
    <div className="border border-slate-200 rounded">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center justify-between bg-slate-50 hover:bg-slate-100"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-700">
            Lines ({lines.length})
          </span>
          {hasLevels && (
            <span className="text-[10px] text-slate-500">
              · multi-level (up to L{maxLevel})
            </span>
          )}
        </div>
      </button>
      {open && (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="text-left text-[10px] font-black uppercase tracking-widest text-slate-500">
                {hasLevels && <th className="px-2 py-2 w-10 text-center">Lvl</th>}
                <th className="px-3 py-2">Internal PN</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2">MPN</th>
                <th className="px-3 py-2">Mfr</th>
                <th className="px-3 py-2">RefDes</th>
                <th className="px-3 py-2 text-right">$/ea</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => {
                const lvl = l.bomLevel || 1;
                // Indent only on the Internal PN cell so the rest of the row
                // stays column-aligned and skim-readable.
                const indentPx = hasLevels ? Math.min((lvl - 1) * 14, 84) : 0;
                return (
                  <tr key={i} className="hover:bg-slate-50">
                    {hasLevels && (
                      <td className="px-2 py-1.5 text-center text-[10px] font-bold text-slate-500 tabular-nums">
                        {l.bomLevel ?? '—'}
                      </td>
                    )}
                    <td className="px-3 py-1.5 font-mono text-slate-900">
                      <span style={{ paddingLeft: indentPx }}>{l.internalPn || '—'}</span>
                    </td>
                    <td className="px-3 py-1.5 truncate max-w-xs">{l.description || '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{l.qty}</td>
                    <td className="px-3 py-1.5 font-mono">{l.mpn || '—'}</td>
                    <td className="px-3 py-1.5">{l.manufacturer || '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-500">{l.refDes || '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {l.unitCost != null ? `$${l.unitCost.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
