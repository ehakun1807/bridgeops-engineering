// ---------------------------------------------------------------------------
// NCRTool — Per-project Non-Conformance Report tracker.
//
// Purpose: structured capture and tracking of non-conformances found during
// NPI — incoming material, in-process failures, supplier deviations, design
// escapes, documentation gaps. Follows ISO 9001 / IATF 16949 / 21 CFR Part 820
// NCR conventions.
//
// Each NCR carries:
//   • Non-conformance description + detected phase/gate
//   • Category: product / process / supplier / material / documentation / other
//   • Severity: critical / major / minor
//   • Quantity affected + part / process reference
//   • Disposition: use-as-is / rework / repair / scrap / return-to-vendor / pending
//   • Root cause (free text — 5-Why / Ishikawa)
//   • Corrective action (CAPA text)
//   • Preventive action
//   • Status: open → under_investigation → capa_in_progress → closed / cancelled
//   • Closed date + verification note
//
// Lifecycle: status progresses open → under_investigation → capa_in_progress → closed.
// Closed NCRs are retained for traceability. Cancelled = voided (kept for record).
//
// Persistence: `ncrs` Firestore collection, one doc per NCR.
// userId + projectId scoped, composite index (userId asc, projectId asc, dateMs desc).
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileWarning,
  Plus,
  Loader2,
  ArrowLeft,
  Save,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  X,
  Calendar,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from 'lucide-react';
import { db, auth } from './firebase.ts';
import { logActivity } from './activityLogger.ts';
import { PushToOpenItemsInline } from './OpenItemsPanel.tsx';
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

export type NCRCategory  = 'product' | 'process' | 'supplier' | 'material' | 'documentation' | 'other';
export type NCRSeverity  = 'critical' | 'major' | 'minor';
export type NCRDisposition = 'pending' | 'use_as_is' | 'rework' | 'repair' | 'scrap' | 'return_to_vendor';
export type NCRStatus    = 'open' | 'under_investigation' | 'capa_in_progress' | 'closed' | 'cancelled';

export interface NCR {
  id: string;
  userId: string;
  projectId: string;
  ncrNumber: string;         // e.g. "NCR-001" — auto-generated on create
  dateMs: number;            // date detected (UTC midnight)
  title: string;             // ≤150 char, required
  category: NCRCategory;
  severity: NCRSeverity;
  gate?: string;             // phase detected (CR/PDR/CDR/TRR/PRR/MP)
  partProcess: string;       // ≤200 char — affected part number, process step, or doc ref
  qtyAffected: string;       // ≤50 char — quantity + unit (e.g. "24 pcs", "Lot #A204")
  detectedBy: string;        // ≤100 char
  description: string;       // ≤600 char — what the non-conformance is
  containment: string;       // ≤500 char — immediate containment action taken
  disposition: NCRDisposition;
  rootCause: string;         // ≤600 char
  correctiveAction: string;  // ≤600 char — CAPA
  preventiveAction: string;  // ≤500 char
  status: NCRStatus;
  closedDateMs?: number;
  verificationNote: string;  // ≤400 char — confirmation that CAPA was effective
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<NCRCategory, string> = {
  product:       'Product',
  process:       'Process',
  supplier:      'Supplier',
  material:      'Material',
  documentation: 'Documentation',
  other:         'Other',
};

const SEVERITY_LABELS: Record<NCRSeverity, string> = {
  critical: 'Critical',
  major:    'Major',
  minor:    'Minor',
};

const SEVERITY_COLORS: Record<NCRSeverity, string> = {
  critical: 'bg-rose-100 text-rose-800 border-rose-300',
  major:    'bg-amber-100 text-amber-800 border-amber-300',
  minor:    'bg-slate-100 text-slate-700 border-slate-300',
};

const DISPOSITION_LABELS: Record<NCRDisposition, string> = {
  pending:         'Pending Decision',
  use_as_is:       'Use As-Is',
  rework:          'Rework',
  repair:          'Repair',
  scrap:           'Scrap',
  return_to_vendor:'Return to Vendor',
};

const STATUS_LABELS: Record<NCRStatus, string> = {
  open:                'Open',
  under_investigation: 'Under Investigation',
  capa_in_progress:    'CAPA In Progress',
  closed:              'Closed',
  cancelled:           'Cancelled',
};

const STATUS_COLORS: Record<NCRStatus, string> = {
  open:                'bg-rose-100 text-rose-800 border-rose-300',
  under_investigation: 'bg-amber-100 text-amber-800 border-amber-300',
  capa_in_progress:    'bg-blue-100 text-blue-800 border-blue-300',
  closed:              'bg-emerald-100 text-emerald-800 border-emerald-300',
  cancelled:           'bg-slate-100 text-slate-500 border-slate-300',
};

const GATE_OPTIONS = ['CR', 'PDR', 'CDR', 'TRR', 'PRR', 'MP'];

const TITLE_MAX        = 150;
const PART_MAX         = 200;
const QTY_MAX          = 50;
const DETECTED_BY_MAX  = 100;
const DESC_MAX         = 600;
const CONTAINMENT_MAX  = 500;
const ROOT_CAUSE_MAX   = 600;
const CAPA_MAX         = 600;
const PREVENTIVE_MAX   = 500;
const VERIFY_MAX       = 400;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayMs(): number {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
}

function msToDateInput(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateInputToMs(val: string): number {
  if (!val) return todayMs();
  const [y, m, d] = val.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function generateNcrNumber(existing: NCR[]): string {
  const nums = existing
    .map(n => parseInt(n.ncrNumber.replace('NCR-', ''), 10))
    .filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `NCR-${String(next).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// CharCounter
// ---------------------------------------------------------------------------
function CharCounter({ value, max }: { value: string; max: number }) {
  const remaining = max - value.length;
  return (
    <span className={`text-[10px] ${remaining < 20 ? 'text-amber-500' : 'text-slate-400'}`}>
      {remaining}
    </span>
  );
}

// ---------------------------------------------------------------------------
// NCRCard (list row)
// ---------------------------------------------------------------------------
function NCRCard({
  ncr,
  onOpen,
  onDelete,
}: {
  ncr: NCR;
  onOpen: (n: NCR) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div
      className="border border-slate-200 rounded-lg bg-white hover:border-rose-300 hover:shadow-sm transition-all cursor-pointer"
      onClick={() => onOpen(ncr)}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        {/* left accent */}
        <div className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          ncr.severity === 'critical' ? 'bg-rose-500' :
          ncr.severity === 'major'    ? 'bg-amber-500' : 'bg-slate-400'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-slate-500">{ncr.ncrNumber}</span>
            <span className={`text-[10px] border rounded px-1.5 py-0.5 font-medium ${SEVERITY_COLORS[ncr.severity]}`}>
              {SEVERITY_LABELS[ncr.severity]}
            </span>
            <span className={`text-[10px] border rounded px-1.5 py-0.5 ${STATUS_COLORS[ncr.status]}`}>
              {STATUS_LABELS[ncr.status]}
            </span>
            {ncr.gate && (
              <span className="text-[10px] bg-sky-50 border border-sky-200 text-sky-700 rounded px-1.5 py-0.5">
                {ncr.gate}
              </span>
            )}
            <span className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
              {CATEGORY_LABELS[ncr.category]}
            </span>
          </div>
          <p className="text-sm font-medium text-slate-800 mt-1 truncate">{ncr.title}</p>
          {ncr.partProcess && (
            <p className="text-xs text-slate-500 truncate">{ncr.partProcess}</p>
          )}
          <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400">
            <span>{formatDate(ncr.dateMs)}</span>
            {ncr.detectedBy && <span>· {ncr.detectedBy}</span>}
            <span>· {DISPOSITION_LABELS[ncr.disposition]}</span>
          </div>
        </div>
        <div className="flex-shrink-0 flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {confirmDelete ? (
            <>
              <button
                className="text-[10px] text-rose-600 hover:text-rose-800 px-2 py-1 border border-rose-300 rounded"
                onClick={() => onDelete(ncr.id)}
              >Confirm</button>
              <button
                className="text-[10px] text-slate-500 px-2 py-1"
                onClick={() => setConfirmDelete(false)}
              >Cancel</button>
            </>
          ) : (
            <button
              className="text-slate-400 hover:text-rose-500 p-1 rounded"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NCRForm
// ---------------------------------------------------------------------------
function NCRForm({
  initial,
  allNcrs,
  projectId,
  currentGate,
  readOnly,
  onSave,
  onCancel,
}: {
  initial: Partial<NCR>;
  allNcrs: NCR[];
  projectId: string;
  currentGate?: string;
  readOnly?: boolean;
  onSave: (data: Partial<NCR>) => Promise<void>;
  onCancel: () => void;
}) {
  const isNew = !initial.id;

  const [ncrNumber]       = useState(initial.ncrNumber ?? generateNcrNumber(allNcrs));
  const [dateVal, setDateVal]           = useState(msToDateInput(initial.dateMs ?? todayMs()));
  const [title, setTitle]               = useState(initial.title ?? '');
  const [category, setCategory]         = useState<NCRCategory>(initial.category ?? 'product');
  const [severity, setSeverity]         = useState<NCRSeverity>(initial.severity ?? 'major');
  const [gate, setGate]                 = useState(initial.gate ?? currentGate ?? '');
  const [partProcess, setPartProcess]   = useState(initial.partProcess ?? '');
  const [qtyAffected, setQtyAffected]   = useState(initial.qtyAffected ?? '');
  const [detectedBy, setDetectedBy]     = useState(initial.detectedBy ?? '');
  const [description, setDescription]   = useState(initial.description ?? '');
  const [containment, setContainment]   = useState(initial.containment ?? '');
  const [disposition, setDisposition]   = useState<NCRDisposition>(initial.disposition ?? 'pending');
  const [rootCause, setRootCause]       = useState(initial.rootCause ?? '');
  const [correctiveAction, setCA]       = useState(initial.correctiveAction ?? '');
  const [preventiveAction, setPA]       = useState(initial.preventiveAction ?? '');
  const [status, setStatus]             = useState<NCRStatus>(initial.status ?? 'open');
  const [closedDateVal, setClosedDateVal] = useState(
    initial.closedDateMs ? msToDateInput(initial.closedDateMs) : ''
  );
  const [verificationNote, setVerify]   = useState(initial.verificationNote ?? '');

  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [showCapa, setShowCapa] = useState(
    !!(initial.rootCause || initial.correctiveAction || initial.preventiveAction)
  );

  const canSave = title.trim().length > 0 && description.trim().length > 0;

  async function handleSave() {
    if (!canSave || saving || readOnly) return;
    setSaving(true);
    setError('');
    try {
      await onSave({
        ncrNumber,
        dateMs:           dateInputToMs(dateVal),
        title:            title.trim(),
        category,
        severity,
        gate:             gate || undefined,
        partProcess:      partProcess.trim(),
        qtyAffected:      qtyAffected.trim(),
        detectedBy:       detectedBy.trim(),
        description:      description.trim(),
        containment:      containment.trim(),
        disposition,
        rootCause:        rootCause.trim(),
        correctiveAction: correctiveAction.trim(),
        preventiveAction: preventiveAction.trim(),
        status,
        closedDateMs:     (status === 'closed' || status === 'cancelled') && closedDateVal
                          ? dateInputToMs(closedDateVal) : undefined,
        verificationNote: verificationNote.trim(),
      });
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-0">
      {/* Header */}
      <div className="bg-slate-900 rounded-t-xl px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-rose-400 font-semibold mb-0.5">
              NCR · {ncrNumber}
            </p>
            <h3 className="text-white font-semibold text-sm">
              {isNew ? 'New Non-Conformance Report' : title || 'Edit NCR'}
            </h3>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="bg-slate-50 rounded-b-xl border border-t-0 border-slate-200 p-5 flex flex-col gap-5">

        {/* Row 1: Date / Severity / Category */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">
              Date Detected
            </label>
            <input
              type="date"
              value={dateVal}
              onChange={e => setDateVal(e.target.value)}
              disabled={readOnly}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-slate-100"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">
              Severity
            </label>
            <div className="flex gap-1">
              {(['critical','major','minor'] as NCRSeverity[]).map(s => (
                <button
                  key={s}
                  disabled={readOnly}
                  onClick={() => setSeverity(s)}
                  className={`flex-1 text-[10px] font-medium py-2 rounded-lg border transition-all ${
                    severity === s
                      ? s === 'critical' ? 'bg-rose-600 text-white border-rose-600'
                        : s === 'major'  ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-slate-500 text-white border-slate-500'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {SEVERITY_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">
              Gate / Phase
            </label>
            <select
              value={gate}
              onChange={e => setGate(e.target.value)}
              disabled={readOnly}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-slate-100"
            >
              <option value="">—</option>
              {GATE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2: Category */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">
            Category
          </label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CATEGORY_LABELS) as NCRCategory[]).map(c => (
              <button
                key={c}
                disabled={readOnly}
                onClick={() => setCategory(c)}
                className={`text-[11px] px-3 py-1.5 rounded-full border transition-all ${
                  category === c
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-rose-300'
                }`}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              NCR Title <span className="text-rose-400">*</span>
            </label>
            <CharCounter value={title} max={TITLE_MAX} />
          </div>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value.slice(0, TITLE_MAX))}
            placeholder="Short, specific description of the non-conformance"
            disabled={readOnly}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-slate-100"
          />
        </div>

        {/* Part / Process + Qty + Detected By */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Part / Process Ref
              </label>
              <CharCounter value={partProcess} max={PART_MAX} />
            </div>
            <input
              type="text"
              value={partProcess}
              onChange={e => setPartProcess(e.target.value.slice(0, PART_MAX))}
              placeholder="PN, WI-014, Step 3…"
              disabled={readOnly}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-slate-100"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Qty Affected
              </label>
              <CharCounter value={qtyAffected} max={QTY_MAX} />
            </div>
            <input
              type="text"
              value={qtyAffected}
              onChange={e => setQtyAffected(e.target.value.slice(0, QTY_MAX))}
              placeholder="24 pcs / Lot #A204"
              disabled={readOnly}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-slate-100"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Detected By
              </label>
              <CharCounter value={detectedBy} max={DETECTED_BY_MAX} />
            </div>
            <input
              type="text"
              value={detectedBy}
              onChange={e => setDetectedBy(e.target.value.slice(0, DETECTED_BY_MAX))}
              placeholder="Name / team"
              disabled={readOnly}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-slate-100"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Non-Conformance Description <span className="text-rose-400">*</span>
            </label>
            <CharCounter value={description} max={DESC_MAX} />
          </div>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value.slice(0, DESC_MAX))}
            rows={3}
            placeholder="What is out of spec or non-conforming? Reference drawing/spec/WI as applicable."
            disabled={readOnly}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 resize-none disabled:bg-slate-100"
          />
        </div>

        {/* Containment */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Immediate Containment
            </label>
            <CharCounter value={containment} max={CONTAINMENT_MAX} />
          </div>
          <textarea
            value={containment}
            onChange={e => setContainment(e.target.value.slice(0, CONTAINMENT_MAX))}
            rows={2}
            placeholder="Quarantine, sort, hold, rework already in progress…"
            disabled={readOnly}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 resize-none disabled:bg-slate-100"
          />
        </div>

        {/* Disposition */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">
            Disposition
          </label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(DISPOSITION_LABELS) as NCRDisposition[]).map(d => (
              <button
                key={d}
                disabled={readOnly}
                onClick={() => setDisposition(d)}
                className={`text-[11px] px-3 py-1.5 rounded-full border transition-all ${
                  disposition === d
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}
              >
                {DISPOSITION_LABELS[d]}
              </button>
            ))}
          </div>
        </div>

        {/* CAPA section — collapsible */}
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowCapa(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700"
          >
            <span>Root Cause &amp; CAPA</span>
            {showCapa ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showCapa && (
            <div className="bg-white border-t border-slate-100 px-4 pb-4 flex flex-col gap-4 pt-3">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Root Cause
                  </label>
                  <CharCounter value={rootCause} max={ROOT_CAUSE_MAX} />
                </div>
                <textarea
                  value={rootCause}
                  onChange={e => setRootCause(e.target.value.slice(0, ROOT_CAUSE_MAX))}
                  rows={3}
                  placeholder="5-Why or Ishikawa summary — what caused this non-conformance?"
                  disabled={readOnly}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 resize-none disabled:bg-slate-100"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Corrective Action (CAPA)
                  </label>
                  <CharCounter value={correctiveAction} max={CAPA_MAX} />
                </div>
                <textarea
                  value={correctiveAction}
                  onChange={e => setCA(e.target.value.slice(0, CAPA_MAX))}
                  rows={3}
                  placeholder="What specific corrective actions will be taken? Who is responsible and by when?"
                  disabled={readOnly}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 resize-none disabled:bg-slate-100"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Preventive Action
                  </label>
                  <CharCounter value={preventiveAction} max={PREVENTIVE_MAX} />
                </div>
                <textarea
                  value={preventiveAction}
                  onChange={e => setPA(e.target.value.slice(0, PREVENTIVE_MAX))}
                  rows={2}
                  placeholder="What systemic change prevents recurrence?"
                  disabled={readOnly}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 resize-none disabled:bg-slate-100"
                />
              </div>
            </div>
          )}
        </div>

        {/* Status */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">
            Status
          </label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(STATUS_LABELS) as NCRStatus[]).map(s => (
              <button
                key={s}
                disabled={readOnly}
                onClick={() => setStatus(s)}
                className={`text-[11px] px-3 py-1.5 rounded-full border transition-all ${
                  status === s
                    ? s === 'closed'              ? 'bg-emerald-600 text-white border-emerald-600'
                      : s === 'open'              ? 'bg-rose-600 text-white border-rose-600'
                      : s === 'under_investigation'? 'bg-amber-500 text-white border-amber-500'
                      : s === 'capa_in_progress'  ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-slate-500 text-white border-slate-500'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Closed date + verification — shown when closed/cancelled */}
        {(status === 'closed' || status === 'cancelled') && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">
                Closed / Cancelled Date
              </label>
              <input
                type="date"
                value={closedDateVal}
                onChange={e => setClosedDateVal(e.target.value)}
                disabled={readOnly}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-slate-100"
              />
            </div>
            {status === 'closed' && (
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Verification of Effectiveness
                  </label>
                  <CharCounter value={verificationNote} max={VERIFY_MAX} />
                </div>
                <input
                  type="text"
                  value={verificationNote}
                  onChange={e => setVerify(e.target.value.slice(0, VERIFY_MAX))}
                  placeholder="How was CAPA effectiveness confirmed?"
                  disabled={readOnly}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-slate-100"
                />
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            {!isNew && !readOnly && (
              <PushToOpenItemsInline
                db={db}
                userId={auth.currentUser?.uid ?? ''}
                projectId={initial.projectId ?? ''}
                sourceId={initial.id ?? ''}
                sourceTool="ncr"
                sourceTitle={title || ncrNumber}
              />
            )}
            {!canSave && (
              <span className="text-[10px] text-slate-400">Title and description required</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">
              Cancel
            </button>
            {!readOnly && (
              <button
                onClick={handleSave}
                disabled={!canSave || saving}
                className="flex items-center gap-1.5 text-sm bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save NCR
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface NCRToolProps {
  projectId: string;
  projectName: string;
  currentGate?: string;
  readOnly?: boolean;
}

export default function NCRTool({
  projectId,
  projectName,
  currentGate,
  readOnly,
}: NCRToolProps) {
  const [ncrs, setNcrs]         = useState<NCR[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState<Partial<NCR> | null>(null);
  const [error, setError]       = useState('');

  const userId = auth.currentUser?.uid ?? '';

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId || !projectId) { setLoading(false); return; }
    setLoading(true);
    const q = query(
      collection(db, 'ncrs'),
      where('userId', '==', userId),
      where('projectId', '==', projectId),
      orderBy('dateMs', 'desc')
    );
    getDocs(q)
      .then(snap => {
        setNcrs(snap.docs.map(d => ({ id: d.id, ...d.data() } as NCR)));
      })
      .catch(e => setError(e?.message ?? 'Failed to load NCRs'))
      .finally(() => setLoading(false));
  }, [userId, projectId]);

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave(data: Partial<NCR>) {
    if (!userId) return;
    const isNew = !editing?.id;
    const payload = {
      ...data,
      userId,
      projectId,
      updatedAt: serverTimestamp(),
    };

    if (isNew) {
      const ref = await addDoc(collection(db, 'ncrs'), {
        ...payload,
        createdAt: serverTimestamp(),
      });
      const newNcr = { id: ref.id, ...payload } as NCR;
      setNcrs(prev => [newNcr, ...prev]);
      logActivity({
        userId, projectId,
        eventType: 'ncr_created',
        tool: 'ncr',
        title: `NCR logged: ${data.ncrNumber}`,
        detail: `${data.severity?.toUpperCase()} · ${data.title?.slice(0, 80)}`,
        timestampMs: Date.now(),
        metadata: { severity: data.severity ?? '', category: data.category ?? '' },
      });
    } else {
      const ref = doc(db, 'ncrs', editing!.id!);
      await updateDoc(ref, payload);
      setNcrs(prev => prev.map(n => n.id === editing!.id ? { ...n, ...payload } as NCR : n));
      const eventType = data.status === 'closed' ? 'ncr_closed' : 'ncr_updated';
      logActivity({
        userId, projectId,
        eventType,
        tool: 'ncr',
        title: `NCR ${data.status === 'closed' ? 'closed' : 'updated'}: ${data.ncrNumber}`,
        detail: data.title?.slice(0, 100),
        timestampMs: Date.now(),
        metadata: { severity: data.severity ?? '', status: data.status ?? '' },
      });
    }
    setEditing(null);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    const ncr = ncrs.find(n => n.id === id);
    await deleteDoc(doc(db, 'ncrs', id));
    setNcrs(prev => prev.filter(n => n.id !== id));
    logActivity({
      userId, projectId,
      eventType: 'ncr_deleted',
      tool: 'ncr',
      title: `NCR deleted: ${ncr?.ncrNumber ?? id}`,
      timestampMs: Date.now(),
    });
  }

  // ── Summary stats ──────────────────────────────────────────────────────────
  const openCount     = ncrs.filter(n => n.status === 'open' || n.status === 'under_investigation' || n.status === 'capa_in_progress').length;
  const criticalCount = ncrs.filter(n => n.severity === 'critical' && n.status !== 'closed' && n.status !== 'cancelled').length;
  const closedCount   = ncrs.filter(n => n.status === 'closed').length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-rose-900/50 flex items-center justify-center">
              <FileWarning size={16} className="text-rose-400" />
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-rose-400 font-semibold">
                Tool · Non-Conformance Reports
              </p>
              <h3 className="text-white font-semibold text-sm">NCR Tracker</h3>
            </div>
          </div>
          {!readOnly && !editing && (
            <button
              onClick={() => setEditing({})}
              className="flex items-center gap-1.5 text-xs bg-rose-600 hover:bg-rose-700 text-white px-3 py-2 rounded-lg font-medium"
            >
              <Plus size={13} /> New NCR
            </button>
          )}
          {editing && (
            <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-white">
              <ArrowLeft size={16} />
            </button>
          )}
        </div>

        {/* Summary strip */}
        {!editing && ncrs.length > 0 && (
          <div className="mt-3 flex items-center gap-4 text-[11px]">
            <span className="text-slate-400">{ncrs.length} total</span>
            {openCount > 0 && (
              <span className="text-rose-400 font-medium flex items-center gap-1">
                <AlertCircle size={11} /> {openCount} open
              </span>
            )}
            {criticalCount > 0 && (
              <span className="text-rose-300 font-semibold">{criticalCount} critical</span>
            )}
            <span className="text-emerald-400">{closedCount} closed</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <AnimatePresence mode="wait">
          {editing ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              <NCRForm
                initial={editing}
                allNcrs={ncrs}
                projectId={projectId}
                currentGate={currentGate}
                readOnly={readOnly}
                onSave={handleSave}
                onCancel={() => setEditing(null)}
              />
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
            >
              {loading ? (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <Loader2 size={20} className="animate-spin mr-2" />
                  <span className="text-sm">Loading NCRs…</span>
                </div>
              ) : error ? (
                <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-4">
                  {error}
                  {error.includes('index') && (
                    <p className="mt-1 text-xs text-rose-500">
                      This collection requires a Firestore composite index. Add it in Firebase Console → Indexes and wait for "Enabled."
                    </p>
                  )}
                </div>
              ) : ncrs.length === 0 ? (
                <div className="text-center py-14">
                  <FileWarning size={28} className="text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500 font-medium">No NCRs logged yet</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                    Log non-conformances from incoming inspection, in-process failures, supplier deviations, or design escapes.
                  </p>
                  {!readOnly && (
                    <button
                      onClick={() => setEditing({})}
                      className="mt-4 text-sm bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg"
                    >
                      Log first NCR
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {ncrs.map(ncr => (
                    <NCRCard
                      key={ncr.id}
                      ncr={ncr}
                      onOpen={n => setEditing(n)}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
