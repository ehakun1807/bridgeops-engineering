// ---------------------------------------------------------------------------
// ControlPlanTool — Per-project AIAG-aligned Control Plan.
//
// Completes the classic NPI quality triad: Process Map → PFMEA → Control Plan.
// Each Control Plan is a header (plan type, revision, participants) + a list
// of ControlItems (rows), each mapping one process step to its characteristic,
// specification, measurement technique, sample plan, and reaction plan.
//
// Cross-tool links:
//   - Each item can reference a Process Map step (loaded from `processMaps`).
//   - Each item can reference a PFMEA risk (loaded from `pfmeas`).
//   Linking is optional — items can be created standalone.
//
// Standards basis: AIAG Control Plan (4th edition fields adapted for a
// single-user digital workflow). Not a replacement for a formal AIAG Excel
// template — intended as a living readiness document in the NPI workspace.
//
// Persistence: `controlPlans` Firestore collection.
// userId + projectId scoped. Always editable. Composite index
// (userId asc, projectId asc, dateMs desc).
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ClipboardList,
  Plus,
  Loader2,
  ArrowLeft,
  Save,
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Link2,
  ShieldAlert,
  Workflow,
  CheckCircle2,
  Circle,
  Download
} from 'lucide-react';
import { downloadControlPlanXlsx } from './controlPlanXlsx.ts';
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

export type ControlPlanType   = 'prototype' | 'pre_launch' | 'production';
export type CharType          = 'product' | 'process';
export type SpecialClass      = 'critical' | 'significant' | 'none';

export interface ControlItem {
  id: string;
  // Cross-tool links (optional — dropdowns populated from loaded process maps / pfmeas)
  processMapStepId?: string;    // step id in the linked process map
  pfmeaDocId?: string;          // which pfmea doc the risk belongs to
  pfmeaRiskId?: string;         // specific risk id within that pfmea doc
  // Process identification
  processStep: string;          // ≤200 char — the manufacturing step name
  machineFixture?: string;      // ≤100 char — machine / device / jig / fixture
  // Characteristic
  charType: CharType;           // product (output measurement) or process (input parameter)
  productCharacteristic?: string;  // ≤200 char
  processCharacteristic?: string;  // ≤200 char
  specialClass: SpecialClass;   // Critical / Significant / None
  // Control definition
  specificationTolerance?: string; // ≤200 char — nominal ± tolerance, pass/fail limit
  measurementTechnique?: string;   // ≤150 char — gauge, CMM, visual, attribute, etc.
  sampleSize?: string;             // ≤50 char  — e.g. "5 pcs", "100%"
  sampleFrequency?: string;        // ≤100 char — e.g. "every lot", "hourly", "first-off"
  controlMethod?: string;          // ≤200 char — SPC, visual check, poka-yoke, attribute
  reactionPlan?: string;           // ≤300 char — what to do when out of control
}

export interface ControlPlan {
  id: string;
  userId: string;
  projectId: string;
  planType: ControlPlanType;
  title: string;               // ≤200 char — process / product name (required)
  partDescription?: string;    // ≤200 char — optional context
  revisionLevel?: string;      // ≤20 char  — "Rev A", "v1.2", etc.
  dateMs: number;
  participants?: string;       // ≤500 char — core team
  items: ControlItem[];
  linkedProcessMapId?: string; // which process map was used for step lookup
  linkedPfmeaId?: string;      // which pfmea was used for risk lookup
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAN_TYPE_LABELS: Record<ControlPlanType, string> = {
  prototype:   'Prototype',
  pre_launch:  'Pre-Launch',
  production:  'Production',
};

const PLAN_TYPE_COLORS: Record<ControlPlanType, string> = {
  prototype:   'border-slate-300 bg-slate-50 text-slate-700',
  pre_launch:  'border-amber-200 bg-amber-50 text-amber-700',
  production:  'border-orange-200 bg-orange-50 text-orange-700',
};

const SPECIAL_CLASS_CONFIG: Record<SpecialClass, { label: string; chipCls: string; dot: string }> = {
  critical:    { label: 'Critical',    chipCls: 'border-rose-300 bg-rose-50 text-rose-700',     dot: 'bg-rose-500' },
  significant: { label: 'Significant', chipCls: 'border-amber-200 bg-amber-50 text-amber-700',  dot: 'bg-amber-400' },
  none:        { label: 'None',        chipCls: 'border-slate-200 bg-slate-50 text-slate-500',   dot: 'bg-slate-300' },
};

const TITLE_MAX        = 200;
const DESC_MAX         = 200;
const REV_MAX          = 20;
const PART_MAX         = 500;
const STEP_MAX         = 200;
const MACHINE_MAX      = 100;
const CHAR_MAX         = 200;
const SPEC_MAX         = 200;
const MEAS_MAX         = 150;
const SAMPLE_SIZE_MAX  = 50;
const SAMPLE_FREQ_MAX  = 100;
const METHOD_MAX       = 200;
const REACTION_MAX     = 300;

// ---------------------------------------------------------------------------
// Date helpers (same pattern as MeetingsTool / ProductBomTool)
// ---------------------------------------------------------------------------
function todayDateInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function msFromDateInput(v: string): number {
  if (!v) return Date.now();
  const [y, m, d] = v.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function msToDateInput(ms: number): string {
  if (!ms) return todayDateInputValue();
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function formatDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------
// ID helper
// ---------------------------------------------------------------------------
function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function emptyItem(): ControlItem {
  return {
    id: newId(),
    processStep: '',
    charType: 'product',
    specialClass: 'none',
  };
}

// ---------------------------------------------------------------------------
// Slim types for cross-link dropdowns
// ---------------------------------------------------------------------------
interface StepRef {
  id: string;
  description: string;
  kind: string; // 'start' | 'action' | 'decision' | 'end'
}
interface RiskRef {
  id: string;
  docId: string;
  label: string; // "processStep — failureMode"
}

// ---------------------------------------------------------------------------
// ControlItemCard
// ---------------------------------------------------------------------------
interface ControlItemCardProps {
  item: ControlItem;
  index: number;
  steps: StepRef[];
  risks: RiskRef[];
  onChange: (updated: ControlItem) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const ControlItemCard: React.FC<ControlItemCardProps> = ({
  item, index, steps, risks, onChange, onDuplicate, onDelete
}) => {
  const [expanded, setExpanded] = useState(true);
  const cls = SPECIAL_CLASS_CONFIG[item.specialClass];
  const linkedStep = steps.find((s) => s.id === item.processMapStepId);
  const linkedRisk = risks.find((r) => r.id === item.pfmeaRiskId);

  const upd = (patch: Partial<ControlItem>) => onChange({ ...item, ...patch });

  return (
    <div className={`border rounded-md overflow-hidden ${
      item.specialClass === 'critical' ? 'border-rose-200' :
      item.specialClass === 'significant' ? 'border-amber-200' :
      'border-slate-200'
    }`}>
      {/* Top bar */}
      <div className={`flex items-center gap-2 px-3 py-2 ${
        item.specialClass === 'critical' ? 'bg-rose-50' :
        item.specialClass === 'significant' ? 'bg-amber-50' :
        'bg-slate-50'
      }`}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-slate-400 hover:text-slate-700 flex-shrink-0"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex-shrink-0">
          #{index + 1}
        </span>
        {item.processStep ? (
          <span className="text-sm font-semibold text-slate-800 truncate">
            {item.processStep}
          </span>
        ) : (
          <span className="text-sm text-slate-400 italic">Untitled step</span>
        )}
        {/* Badges */}
        <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
          {item.specialClass !== 'none' && (
            <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${cls.chipCls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cls.dot}`} />
              {cls.label}
            </span>
          )}
          {linkedStep && (
            <span className="inline-flex items-center gap-1 border border-blue-200 bg-blue-50 text-blue-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">
              <Workflow size={8} /> Mapped
            </span>
          )}
          {linkedRisk && (
            <span className="inline-flex items-center gap-1 border border-rose-200 bg-rose-50 text-rose-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">
              <ShieldAlert size={8} /> PFMEA
            </span>
          )}
          <button type="button" onClick={onDuplicate} title="Duplicate" className="text-slate-400 hover:text-blue-600 ml-1">
            <Copy size={12} />
          </button>
          <button type="button" onClick={onDelete} title="Delete" className="text-slate-400 hover:text-rose-600">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 py-4 space-y-4 bg-white">
          {/* Row 1: Process step + machine + cross-links */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Process Step *</span>
              <input
                type="text"
                value={item.processStep}
                maxLength={STEP_MAX}
                onChange={(e) => upd({ processStep: e.target.value })}
                placeholder="e.g. SMT Paste Printing"
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Machine / Device / Fixture</span>
              <input
                type="text"
                value={item.machineFixture || ''}
                maxLength={MACHINE_MAX}
                onChange={(e) => upd({ machineFixture: e.target.value })}
                placeholder="e.g. DEK printer, AOI Saki-X"
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </label>
            {steps.length > 0 && (
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1">
                  <Workflow size={10} /> Link to Process Map Step
                </span>
                <select
                  value={item.processMapStepId || ''}
                  onChange={(e) => upd({ processMapStepId: e.target.value || undefined })}
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                >
                  <option value="">— None —</option>
                  {steps.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.description || s.kind} ({s.kind})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {risks.length > 0 && (
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1">
                  <ShieldAlert size={10} /> Link to PFMEA Risk
                </span>
                <select
                  value={item.pfmeaRiskId || ''}
                  onChange={(e) => {
                    const r = risks.find((x) => x.id === e.target.value);
                    upd({
                      pfmeaRiskId: e.target.value || undefined,
                      pfmeaDocId:  r?.docId || undefined,
                    });
                  }}
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                >
                  <option value="">— None —</option>
                  {risks.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Row 2: Characteristic */}
          <div className="border-t border-slate-100 pt-3">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Characteristic</span>
              <div className="flex items-center gap-1">
                {(['product', 'process'] as CharType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => upd({ charType: t })}
                    className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded border transition-colors ${
                      item.charType === t
                        ? 'bg-orange-600 border-orange-600 text-white'
                        : 'border-slate-300 text-slate-500 hover:border-slate-400'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 ml-auto">
                <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Class:</span>
                {(['none', 'significant', 'critical'] as SpecialClass[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => upd({ specialClass: c })}
                    className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded border transition-colors ${
                      item.specialClass === c
                        ? SPECIAL_CLASS_CONFIG[c].chipCls + ' font-black'
                        : 'border-slate-200 text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    {SPECIAL_CLASS_CONFIG[c].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Product Characteristic
                  <span className="font-normal normal-case text-slate-400 ml-1">(what to measure on the part)</span>
                </span>
                <input
                  type="text"
                  value={item.productCharacteristic || ''}
                  maxLength={CHAR_MAX}
                  onChange={(e) => upd({ productCharacteristic: e.target.value })}
                  placeholder="e.g. Solder paste height, component placement offset"
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Process Characteristic
                  <span className="font-normal normal-case text-slate-400 ml-1">(what process param to control)</span>
                </span>
                <input
                  type="text"
                  value={item.processCharacteristic || ''}
                  maxLength={CHAR_MAX}
                  onChange={(e) => upd({ processCharacteristic: e.target.value })}
                  placeholder="e.g. Squeegee pressure, reflow profile, line speed"
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </label>
              <label className="block md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Specification / Tolerance</span>
                <input
                  type="text"
                  value={item.specificationTolerance || ''}
                  maxLength={SPEC_MAX}
                  onChange={(e) => upd({ specificationTolerance: e.target.value })}
                  placeholder="e.g. 150µm ± 25µm · 0°±0.5° · Pass/Fail"
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono"
                />
              </label>
            </div>
          </div>

          {/* Row 3: Control method */}
          <div className="border-t border-slate-100 pt-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Control Method</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Measurement</span>
                <input
                  type="text"
                  value={item.measurementTechnique || ''}
                  maxLength={MEAS_MAX}
                  onChange={(e) => upd({ measurementTechnique: e.target.value })}
                  placeholder="e.g. SPI, AOI, CMM, visual"
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Sample Size</span>
                <input
                  type="text"
                  value={item.sampleSize || ''}
                  maxLength={SAMPLE_SIZE_MAX}
                  onChange={(e) => upd({ sampleSize: e.target.value })}
                  placeholder="e.g. 5 pcs, 100%"
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Frequency</span>
                <input
                  type="text"
                  value={item.sampleFrequency || ''}
                  maxLength={SAMPLE_FREQ_MAX}
                  onChange={(e) => upd({ sampleFrequency: e.target.value })}
                  placeholder="e.g. every lot, first-off, hourly"
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Control Method</span>
                <input
                  type="text"
                  value={item.controlMethod || ''}
                  maxLength={METHOD_MAX}
                  onChange={(e) => upd({ controlMethod: e.target.value })}
                  placeholder="e.g. SPC, poka-yoke, attribute"
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label className="block mt-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Reaction Plan
                <span className="font-normal normal-case text-slate-400 ml-1">(what to do when out of control)</span>
              </span>
              <textarea
                value={item.reactionPlan || ''}
                maxLength={REACTION_MAX}
                onChange={(e) => upd({ reactionPlan: e.target.value })}
                placeholder="e.g. Stop line, quarantine last lot, notify engineering, re-run SPC study"
                rows={2}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
              <div className="text-right text-[10px] text-slate-400">{(item.reactionPlan || '').length}/{REACTION_MAX}</div>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ControlPlanTool — main component
// ---------------------------------------------------------------------------
interface ControlPlanToolProps {
  projectId: string;
  projectName: string;
  currentGate?: string;
  readOnly?: boolean;
}

type ToolView = 'list' | 'form';

const ControlPlanTool: React.FC<ControlPlanToolProps> = ({
  projectId,
  projectName,
  currentGate,
  readOnly = false,
}) => {
  const userId = auth.currentUser?.uid ?? '';

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [view, setView]               = useState<ToolView>('list');
  const [plans, setPlans]             = useState<ControlPlan[]>([]);
  const [loading, setLoading]         = useState(true);
  const [editingPlan, setEditingPlan] = useState<ControlPlan | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Cross-link data
  const [steps, setSteps]   = useState<StepRef[]>([]);
  const [risks, setRisks]   = useState<RiskRef[]>([]);

  // Form state
  const [planType, setPlanType]         = useState<ControlPlanType>('production');
  const [title, setTitle]               = useState('');
  const [partDesc, setPartDesc]         = useState('');
  const [revLevel, setRevLevel]         = useState('');
  const [dateVal, setDateVal]           = useState(todayDateInputValue());
  const [participants, setParticipants] = useState('');
  const [items, setItems]               = useState<ControlItem[]>([emptyItem()]);
  const [saving, setSaving]             = useState(false);
  const [saveError, setSaveError]       = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Load plans
  // -------------------------------------------------------------------------
  const loadPlans = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, 'controlPlans'),
          where('userId', '==', userId),
          where('projectId', '==', projectId),
          orderBy('dateMs', 'desc')
        )
      );
      setPlans(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ControlPlan, 'id'>) }))
      );
    } catch (e) {
      console.error('[ControlPlanTool] load failed', e);
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Load cross-link data: latest Process Map steps + latest PFMEA risks
  // -------------------------------------------------------------------------
  const loadCrossLinks = async () => {
    if (!userId) return;
    // Process Map steps
    try {
      const pmSnap = await getDocs(
        query(
          collection(db, 'processMaps'),
          where('userId', '==', userId),
          where('projectId', '==', projectId),
          orderBy('updatedAtMs', 'desc')
        )
      );
      if (!pmSnap.empty) {
        const data = pmSnap.docs[0].data() as any;
        const rawSteps: any[] = data.steps ?? [];
        setSteps(
          rawSteps
            .filter((s: any) => s.kind !== 'start' && s.kind !== 'end')
            .map((s: any) => ({
              id: s.id,
              description: s.description || '',
              kind: s.kind || 'action',
            }))
        );
      }
    } catch (e) {
      console.warn('[ControlPlanTool] process map load failed', e);
    }
    // PFMEA risks
    try {
      const pfSnap = await getDocs(
        query(
          collection(db, 'pfmeas'),
          where('userId', '==', userId),
          where('projectId', '==', projectId),
          orderBy('dateMs', 'desc')
        )
      );
      const allRisks: RiskRef[] = [];
      pfSnap.docs.forEach((d) => {
        const data = d.data() as any;
        const rawRisks: any[] = data.risks ?? [];
        rawRisks.forEach((r: any) => {
          const label = [r.processStep, r.failureMode]
            .filter(Boolean)
            .join(' — ')
            .slice(0, 80) || `Risk #${r.id?.slice(-4) ?? '?'}`;
          allRisks.push({ id: r.id, docId: d.id, label });
        });
      });
      setRisks(allRisks);
    } catch (e) {
      console.warn('[ControlPlanTool] pfmea load failed', e);
    }
  };

  useEffect(() => {
    loadPlans();
    loadCrossLinks();
  }, [userId, projectId]);

  // -------------------------------------------------------------------------
  // Open for editing
  // -------------------------------------------------------------------------
  const openNew = () => {
    setEditingPlan(null);
    setPlanType('production');
    setTitle('');
    setPartDesc('');
    setRevLevel('');
    setDateVal(todayDateInputValue());
    setParticipants('');
    setItems([emptyItem()]);
    setSaveError(null);
    setView('form');
  };

  const openEdit = (plan: ControlPlan) => {
    setEditingPlan(plan);
    setPlanType(plan.planType);
    setTitle(plan.title);
    setPartDesc(plan.partDescription ?? '');
    setRevLevel(plan.revisionLevel ?? '');
    setDateVal(msToDateInput(plan.dateMs));
    setParticipants(plan.participants ?? '');
    setItems(plan.items.length > 0 ? plan.items : [emptyItem()]);
    setSaveError(null);
    setView('form');
  };

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------
  const save = async () => {
    if (!title.trim()) { setSaveError('Title is required.'); return; }
    if (items.filter((it) => it.processStep.trim()).length === 0) {
      setSaveError('At least one control item with a process step is required.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Omit<ControlPlan, 'id'> = {
        userId,
        projectId,
        planType,
        title: title.trim().slice(0, TITLE_MAX),
        partDescription: partDesc.trim().slice(0, DESC_MAX) || undefined,
        revisionLevel: revLevel.trim().slice(0, REV_MAX) || undefined,
        dateMs: msFromDateInput(dateVal),
        participants: participants.trim().slice(0, PART_MAX) || undefined,
        items: items.filter((it) => it.processStep.trim()),
      };

      const isNew = !editingPlan;
      if (isNew) {
        await addDoc(collection(db, 'controlPlans'), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, 'controlPlans', editingPlan!.id), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      }

      // Activity log
      const criticalCount = items.filter((it) => it.specialClass === 'critical').length;
      logActivity({
        userId,
        projectId,
        eventType: isNew ? 'control_plan_created' : 'control_plan_updated',
        tool: 'control_plan',
        title: `Control Plan ${isNew ? 'created' : 'updated'}: ${payload.title}`,
        detail: `${payload.items.length} control items · ${PLAN_TYPE_LABELS[planType]}${criticalCount > 0 ? ` · ${criticalCount} Critical` : ''}`,
        metadata: { itemCount: payload.items.length, planType, criticalCount, gate: currentGate ?? '' },
        timestampMs: Date.now(),
      });

      // Mirror a summary snapshot to the project doc so the header pill can
      // surface control plan maturity without querying the controlPlans collection.
      try {
        const savedItems = payload.items;
        const criticalItems  = savedItems.filter((it) => it.specialClass === 'critical').length;
        const significantItems = savedItems.filter((it) => it.specialClass === 'significant').length;
        await updateDoc(doc(db, 'projects', projectId), {
          controlPlanSummary: {
            planType,
            totalItems: savedItems.length,
            criticalCount: criticalItems,
            significantCount: significantItems,
            lastUpdatedMs: Date.now(),
          }
        });
      } catch (e) {
        console.warn('[ControlPlanTool] controlPlanSummary writeback failed', e);
      }

      await loadPlans();
      setView('list');
    } catch (e: any) {
      console.error('[ControlPlanTool] save failed', e);
      setSaveError(e?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------
  const deletePlan = async (plan: ControlPlan) => {
    try {
      await deleteDoc(doc(db, 'controlPlans', plan.id));
      logActivity({
        userId,
        projectId,
        eventType: 'control_plan_deleted',
        tool: 'control_plan',
        title: `Control Plan deleted: ${plan.title}`,
        metadata: { gate: currentGate ?? '' },
        timestampMs: Date.now(),
      });
      setDeleteConfirm(null);
      await loadPlans();
    } catch (e) {
      console.error('[ControlPlanTool] delete failed', e);
    }
  };

  // -------------------------------------------------------------------------
  // Item helpers
  // -------------------------------------------------------------------------
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const updateItem = (idx: number, updated: ControlItem) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? updated : it)));

  const duplicateItem = (idx: number) =>
    setItems((prev) => [
      ...prev.slice(0, idx + 1),
      { ...prev[idx], id: newId() },
      ...prev.slice(idx + 1),
    ]);

  const deleteItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));

  // -------------------------------------------------------------------------
  // Summary stats
  // -------------------------------------------------------------------------
  const criticalCount   = useMemo(() => plans.flatMap((p) => p.items).filter((it) => it.specialClass === 'critical').length, [plans]);
  const significantCount = useMemo(() => plans.flatMap((p) => p.items).filter((it) => it.specialClass === 'significant').length, [plans]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="min-h-[400px]">
      {/* Header */}
      <div className="bg-slate-900 px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-orange-400">
            Tool · AIAG Control Plan
          </p>
          <h3 className="text-white font-black text-lg leading-tight">Control Plan</h3>
          {plans.length > 0 && (
            <div className="flex items-center gap-3 mt-1">
              <span className="text-[10px] text-slate-400">{plans.length} plan{plans.length !== 1 ? 's' : ''}</span>
              {criticalCount > 0 && (
                <span className="text-[10px] text-rose-400 font-bold">{criticalCount} Critical characteristic{criticalCount !== 1 ? 's' : ''}</span>
              )}
              {significantCount > 0 && (
                <span className="text-[10px] text-amber-400">{significantCount} Significant</span>
              )}
            </div>
          )}
        </div>
        {view === 'list' && (
          <div className="flex items-center gap-2">
            {plans.length > 0 && (
              <button
                type="button"
                disabled={downloading}
                onClick={() => {
                  setDownloading(true);
                  try {
                    downloadControlPlanXlsx(
                      plans.map(p => ({
                        id: p.id,
                        title: p.title,
                        planType: p.planType,
                        partDescription: p.partDescription,
                        revisionLevel: p.revisionLevel,
                        dateMs: p.dateMs,
                        participants: p.participants,
                        items: p.items.map(it => ({
                          processStep: it.processStep,
                          machineFixture: it.machineFixture,
                          charType: it.charType,
                          productCharacteristic: it.productCharacteristic,
                          processCharacteristic: it.processCharacteristic,
                          specialClass: it.specialClass,
                          specificationTolerance: it.specificationTolerance,
                          measurementTechnique: it.measurementTechnique,
                          sampleSize: it.sampleSize,
                          sampleFrequency: it.sampleFrequency,
                          controlMethod: it.controlMethod,
                          reactionPlan: it.reactionPlan
                        }))
                      })),
                      projectName
                    );
                  } finally {
                    setDownloading(false);
                  }
                }}
                title="Download all control plans as Excel"
                className="text-[10px] font-black uppercase tracking-widest text-white/70 hover:text-white transition-colors flex items-center gap-1 disabled:opacity-50"
              >
                {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                Excel
              </button>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={openNew}
                className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 shadow"
              >
                <Plus size={12} /> New Plan
              </button>
            )}
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {/* ------------------------------------------------------------------ */}
        {/* LIST VIEW                                                           */}
        {/* ------------------------------------------------------------------ */}
        {view === 'list' && (
          <motion.div
            key="list"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {loading ? (
              <div className="px-6 py-10 flex items-center gap-2 text-slate-500 text-sm">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : plans.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <ClipboardList size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm font-semibold text-slate-700">No control plans yet</p>
                <p className="text-[12px] text-slate-500 mt-1 mb-4">
                  Add your first control plan to complete the Process Map → PFMEA → Control Plan triad.
                </p>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={openNew}
                    className="bg-orange-600 hover:bg-orange-700 text-white px-5 py-2 text-[10px] font-black uppercase tracking-widest"
                  >
                    New Plan
                  </button>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {plans.map((plan) => {
                  const critCount = plan.items.filter((it) => it.specialClass === 'critical').length;
                  const sigCount  = plan.items.filter((it) => it.specialClass === 'significant').length;
                  return (
                    <li key={plan.id} className="px-6 py-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => openEdit(plan)}
                          className="flex-1 text-left min-w-0"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] text-slate-500">{formatDate(plan.dateMs)}</span>
                            <span className={`inline-flex items-center border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${PLAN_TYPE_COLORS[plan.planType]}`}>
                              {PLAN_TYPE_LABELS[plan.planType]}
                            </span>
                            {plan.revisionLevel && (
                              <span className="text-[10px] font-mono text-slate-500 border border-slate-200 px-1.5 py-0.5">
                                {plan.revisionLevel}
                              </span>
                            )}
                            {critCount > 0 && (
                              <span className="inline-flex items-center gap-1 border border-rose-200 bg-rose-50 text-rose-700 px-1.5 py-0.5 text-[9px] font-black uppercase">
                                {critCount} Critical
                              </span>
                            )}
                            {sigCount > 0 && (
                              <span className="inline-flex items-center gap-1 border border-amber-200 bg-amber-50 text-amber-700 px-1.5 py-0.5 text-[9px] font-black uppercase">
                                {sigCount} Significant
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-bold text-slate-900 mt-1">{plan.title}</p>
                          {plan.partDescription && (
                            <p className="text-[11px] text-slate-500 mt-0.5 italic">{plan.partDescription}</p>
                          )}
                          <p className="text-[11px] text-slate-500 mt-1">
                            {plan.items.length} control item{plan.items.length !== 1 ? 's' : ''}
                            {plan.participants ? ` · ${plan.participants.slice(0, 60)}` : ''}
                          </p>
                        </button>
                        {!readOnly && (
                          deleteConfirm === plan.id ? (
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10px] text-rose-600">Delete?</span>
                              <button
                                type="button"
                                onClick={() => deletePlan(plan)}
                                className="text-[10px] font-black text-rose-600 hover:text-rose-800 uppercase"
                              >Yes</button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirm(null)}
                                className="text-[10px] text-slate-500 uppercase"
                              >No</button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm(plan.id)}
                              className="text-slate-400 hover:text-rose-600 flex-shrink-0 p-1"
                            >
                              <Trash2 size={14} />
                            </button>
                          )
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* FORM VIEW                                                           */}
        {/* ------------------------------------------------------------------ */}
        {view === 'form' && (
          <motion.div
            key="form"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="px-6 py-6 space-y-6"
          >
            {/* Back */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setView('list')}
                className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 flex items-center gap-1"
              >
                <ArrowLeft size={12} /> Back to list
              </button>
              <p className="text-[11px] text-slate-400">
                {editingPlan ? `Editing: ${editingPlan.title}` : 'New Control Plan'}
              </p>
            </div>

            {/* Header fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Plan type */}
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Plan Type</span>
                <div className="flex gap-1 mt-1">
                  {(['prototype', 'pre_launch', 'production'] as ControlPlanType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setPlanType(t)}
                      className={`flex-1 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest rounded border transition-colors ${
                        planType === t
                          ? 'bg-orange-600 border-orange-600 text-white'
                          : 'border-slate-300 text-slate-500 hover:border-slate-400'
                      }`}
                    >
                      {PLAN_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              {/* Date */}
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Date</span>
                <input
                  type="date"
                  value={dateVal}
                  onChange={(e) => setDateVal(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </label>
              {/* Revision */}
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Revision</span>
                <input
                  type="text"
                  value={revLevel}
                  maxLength={REV_MAX}
                  onChange={(e) => setRevLevel(e.target.value)}
                  placeholder="Rev A · v1.0"
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono"
                />
              </label>
              {/* Title */}
              <label className="block md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Title / Process Name *
                </span>
                <input
                  type="text"
                  value={title}
                  maxLength={TITLE_MAX}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. SMT Assembly Control Plan · Final Test Control Plan"
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </label>
              {/* Part description */}
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Part / Process Description</span>
                <input
                  type="text"
                  value={partDesc}
                  maxLength={DESC_MAX}
                  onChange={(e) => setPartDesc(e.target.value)}
                  placeholder="Optional context"
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </label>
              {/* Participants */}
              <label className="block md:col-span-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Core Team / Participants</span>
                <textarea
                  value={participants}
                  maxLength={PART_MAX}
                  onChange={(e) => setParticipants(e.target.value)}
                  placeholder="Names, roles — e.g. John Smith (NPI Eng), Lisa Park (Quality), …"
                  rows={2}
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </label>
            </div>

            {/* Cross-link status */}
            {(steps.length > 0 || risks.length > 0) && (
              <div className="flex items-center gap-3 flex-wrap text-[10px] text-slate-500">
                <span className="font-black uppercase tracking-widest">Cross-links available:</span>
                {steps.length > 0 && (
                  <span className="flex items-center gap-1 text-blue-600">
                    <Workflow size={10} /> {steps.length} Process Map steps
                  </span>
                )}
                {risks.length > 0 && (
                  <span className="flex items-center gap-1 text-rose-600">
                    <ShieldAlert size={10} /> {risks.length} PFMEA risks
                  </span>
                )}
              </div>
            )}

            {/* Control items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Control Items ({items.filter((it) => it.processStep.trim()).length} with process steps)
                </p>
              </div>
              {items.map((item, idx) => (
                <ControlItemCard
                  key={item.id}
                  item={item}
                  index={idx}
                  steps={steps}
                  risks={risks}
                  onChange={(u) => updateItem(idx, u)}
                  onDuplicate={() => duplicateItem(idx)}
                  onDelete={() => deleteItem(idx)}
                />
              ))}
              <button
                type="button"
                onClick={addItem}
                className="w-full border-2 border-dashed border-slate-300 text-slate-500 hover:border-orange-400 hover:text-orange-600 py-3 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plus size={12} /> Add Control Item
              </button>
            </div>

            {/* Save controls */}
            {saveError && (
              <div className="flex items-start gap-2 text-sm text-rose-600">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{saveError}</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              {editingPlan && !readOnly ? (
                <PushToOpenItemsInline
                  db={db}
                  userId={editingPlan.userId}
                  projectId={editingPlan.projectId}
                  sourceTool="control_plan"
                  sourceDocId={editingPlan.id}
                  initialTitle={title || ''}
                />
              ) : <span />}
              <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setView('list')}
                className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || !title.trim()}
                className="bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {editingPlan ? 'Update Plan' : 'Save Plan'}
              </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ControlPlanTool;
