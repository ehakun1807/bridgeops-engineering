
// ---------------------------------------------------------------------------
// SupplierTrackerPage — org-level supplier management with scorecard,
// qualification tracking, and multi-event log.
//
// Route: /#/suppliers
// Firestore: `suppliers/{id}` + `supplierEvents/{id}` (userId-scoped)
// Color palette: purple
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  ChevronLeft,
  Truck,
  Star,
  Calendar,
  Users,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Trash2,
  Edit2,
  Loader2,
  X,
  BarChart3,
  ClipboardCheck,
  Activity,
  Building2,
  Award,
  TrendingUp,
  MapPin,
  Phone,
  Globe,
  Tag,
} from 'lucide-react';
import { db, auth } from './firebase.ts';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupplierCategory =
  | 'ems'
  | 'component'
  | 'material'
  | 'tooling'
  | 'testing_lab'
  | 'logistics'
  | 'other';

export type SupplierStatus =
  | 'candidate'
  | 'under_evaluation'
  | 'qualified'
  | 'disqualified'
  | 'on_hold';

export type SupplierEventType =
  | 'initial_contact'
  | 'site_visit'
  | 'audit'
  | 'sample_review'
  | 'qualification_test'
  | 'contract_negotiation'
  | 'onboarding'
  | 'performance_review'
  | 'issue_raised'
  | 'other';

export interface SupplierScorecard {
  qms: number;              // Quality Management System (ISO 9001, IATF, etc.)
  technical: number;         // Technical capability & engineering support
  financial: number;         // Financial stability & longevity
  delivery: number;          // Delivery performance & lead time reliability
  pricing: number;           // Competitive pricing & total cost
  responsiveness: number;    // Communication & responsiveness
  compliance: number;        // Regulatory & compliance (RoHS, REACH, GDPR, etc.)
  capacity: number;          // Capacity, scalability & flexibility
  innovation: number;        // Innovation, R&D, roadmap
  geographic: number;        // Geographic risk & supply chain resilience
}

export interface Supplier {
  id: string;
  userId: string;
  name: string;
  category: SupplierCategory;
  status: SupplierStatus;
  website?: string;
  contactName?: string;
  contactEmail?: string;
  location?: string;
  notes?: string;
  scorecard: SupplierScorecard;
  overallScore: number; // computed avg
  tags?: string;        // comma-separated
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SupplierEvent {
  id: string;
  userId: string;
  supplierId: string;
  eventType: SupplierEventType;
  title: string;
  dateMs: number;
  motivation: string;    // why this event / what triggered it
  participants: string;  // comma-separated names/roles
  outcome?: string;
  nextSteps?: string;
  status: 'planned' | 'completed' | 'cancelled';
  createdAtMs: number;
  updatedAtMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<SupplierCategory, string> = {
  ems: 'EMS',
  component: 'Component',
  material: 'Material',
  tooling: 'Tooling',
  testing_lab: 'Testing Lab',
  logistics: 'Logistics',
  other: 'Other',
};

const STATUS_LABELS: Record<SupplierStatus, string> = {
  candidate: 'Candidate',
  under_evaluation: 'Under Evaluation',
  qualified: 'Qualified',
  disqualified: 'Disqualified',
  on_hold: 'On Hold',
};

const STATUS_COLORS: Record<SupplierStatus, string> = {
  candidate: 'bg-slate-100 text-slate-700 border-slate-200',
  under_evaluation: 'bg-amber-50 text-amber-700 border-amber-200',
  qualified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  disqualified: 'bg-rose-50 text-rose-700 border-rose-200',
  on_hold: 'bg-orange-50 text-orange-700 border-orange-200',
};

const EVENT_TYPE_LABELS: Record<SupplierEventType, string> = {
  initial_contact: 'Initial Contact',
  site_visit: 'Site Visit',
  audit: 'Audit',
  sample_review: 'Sample Review',
  qualification_test: 'Qualification Test',
  contract_negotiation: 'Contract Negotiation',
  onboarding: 'Onboarding',
  performance_review: 'Performance Review',
  issue_raised: 'Issue Raised',
  other: 'Other',
};

const SCORECARD_PARAMS: Array<{
  key: keyof SupplierScorecard;
  label: string;
  description: string;
}> = [
  { key: 'qms',          label: 'Quality Management',    description: 'ISO 9001, IATF 16949, AS9100, QMS maturity & certifications' },
  { key: 'technical',    label: 'Technical Capability',  description: 'Engineering depth, tooling, process capability (Cpk), NPI support' },
  { key: 'financial',    label: 'Financial Stability',   description: 'Balance sheet health, years in operation, customer concentration' },
  { key: 'delivery',     label: 'Delivery Performance',  description: 'On-time delivery rate, lead time, schedule flexibility' },
  { key: 'pricing',      label: 'Pricing & Cost',        description: 'Competitive pricing, total landed cost, payment terms' },
  { key: 'responsiveness', label: 'Responsiveness',      description: 'Communication speed, escalation handling, engineering support turnaround' },
  { key: 'compliance',   label: 'Regulatory Compliance', description: 'RoHS, REACH, GDPR, conflict minerals, export controls' },
  { key: 'capacity',     label: 'Capacity & Scalability', description: 'Production capacity, ability to scale, buffer stock / safety stock' },
  { key: 'innovation',   label: 'Innovation & Roadmap',  description: 'R&D investment, technology roadmap, proactive improvement mindset' },
  { key: 'geographic',   label: 'Geographic Risk',       description: 'Country risk, single-source exposure, logistics distance, tariff exposure' },
];

const DEFAULT_SCORECARD: SupplierScorecard = {
  qms: 5, technical: 5, financial: 5, delivery: 5, pricing: 5,
  responsiveness: 5, compliance: 5, capacity: 5, innovation: 5, geographic: 5,
};

function computeOverall(sc: SupplierScorecard): number {
  const vals = Object.values(sc) as number[];
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

function scoreColor(score: number): string {
  if (score >= 7.5) return 'text-emerald-600';
  if (score >= 5)   return 'text-amber-600';
  return 'text-rose-600';
}

function scoreBg(score: number): string {
  if (score >= 7.5) return 'bg-emerald-50 border-emerald-200';
  if (score >= 5)   return 'bg-amber-50 border-amber-200';
  return 'bg-rose-50 border-rose-200';
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Radar chart — pure SVG, no deps
// ---------------------------------------------------------------------------

const RadarChart: React.FC<{ scorecard: SupplierScorecard; size?: number }> = ({ scorecard, size = 200 }) => {
  const cx = size / 2;
  const cy = size / 2;
  const r  = size * 0.38;
  const n  = SCORECARD_PARAMS.length;
  const labels = SCORECARD_PARAMS.map(p => p.label.split(' ')[0]); // short labels

  const angle = (i: number) => (i * 2 * Math.PI) / n - Math.PI / 2;
  const pt = (i: number, radius: number) => ({
    x: cx + radius * Math.cos(angle(i)),
    y: cy + radius * Math.sin(angle(i)),
  });

  // Axes
  const axes = SCORECARD_PARAMS.map((_, i) => {
    const end = pt(i, r);
    return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="#e2e8f0" strokeWidth={1} />;
  });

  // Grid rings (levels 2, 4, 6, 8, 10)
  const rings = [2, 4, 6, 8, 10].map((level) => {
    const pts = SCORECARD_PARAMS.map((_, i) => pt(i, r * (level / 10)));
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
    return <path key={level} d={d} fill="none" stroke="#e2e8f0" strokeWidth={level === 10 ? 1.5 : 0.8} />;
  });

  // Data polygon
  const vals = SCORECARD_PARAMS.map(p => scorecard[p.key]);
  const dataPts = vals.map((v, i) => pt(i, r * (v / 10)));
  const dataD = dataPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';

  // Label positions (slightly outside the outermost ring)
  const labelNodes = labels.map((lbl, i) => {
    const p = pt(i, r + 22);
    return (
      <text
        key={i}
        x={p.x}
        y={p.y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={size * 0.055}
        fill="#94a3b8"
        fontWeight="500"
      >
        {lbl}
      </text>
    );
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {rings}
      {axes}
      <path d={dataD} fill="rgba(147,51,234,0.15)" stroke="#9333ea" strokeWidth={2} />
      {dataPts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="#9333ea" />
      ))}
      {labelNodes}
    </svg>
  );
};

// ---------------------------------------------------------------------------
// ScoreSlider — single param row
// ---------------------------------------------------------------------------
const ScoreSlider: React.FC<{
  param: typeof SCORECARD_PARAMS[number];
  value: number;
  onChange: (v: number) => void;
}> = ({ param, value, onChange }) => (
  <div className="flex items-center gap-3 py-1.5">
    <div className="w-36 flex-shrink-0">
      <p className="text-xs font-semibold text-slate-700">{param.label}</p>
      <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{param.description}</p>
    </div>
    <input
      type="range"
      min={1}
      max={10}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="flex-1 accent-purple-600 h-1.5"
    />
    <span className={`w-8 text-center text-sm font-bold tabular-nums ${scoreColor(value)}`}>
      {value}
    </span>
  </div>
);

// ---------------------------------------------------------------------------
// SupplierForm modal
// ---------------------------------------------------------------------------
const EMPTY_SUPPLIER = (): Partial<Supplier> => ({
  name: '',
  category: 'component',
  status: 'candidate',
  website: '',
  contactName: '',
  contactEmail: '',
  location: '',
  notes: '',
  scorecard: { ...DEFAULT_SCORECARD },
  tags: '',
});

interface SupplierFormProps {
  initial?: Supplier | null;
  onSave: (data: Partial<Supplier>) => Promise<void>;
  onClose: () => void;
}

const SupplierForm: React.FC<SupplierFormProps> = ({ initial, onSave, onClose }) => {
  const [form, setForm] = useState<Partial<Supplier>>(initial ? { ...initial, scorecard: { ...initial.scorecard } } : EMPTY_SUPPLIER());
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'details' | 'scorecard'>('details');

  const set = (k: keyof typeof form, v: unknown) => setForm(f => ({ ...f, [k]: v }));
  const setScore = (k: keyof SupplierScorecard, v: number) =>
    setForm(f => ({ ...f, scorecard: { ...(f.scorecard ?? DEFAULT_SCORECARD), [k]: v } }));

  const overall = computeOverall(form.scorecard ?? DEFAULT_SCORECARD);

  const handleSave = async () => {
    if (!form.name?.trim()) return;
    setSaving(true);
    try {
      await onSave({ ...form, overallScore: overall });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">
            {initial ? 'Edit Supplier' : 'Add Supplier'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-slate-100 px-5">
          {(['details', 'scorecard'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-2.5 px-4 text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors ${
                tab === t
                  ? 'border-purple-600 text-purple-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'details' ? 'Details' : `Scorecard · ${overall}/10`}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {tab === 'details' ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Supplier Name *</label>
                <input
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400"
                  value={form.name ?? ''}
                  onChange={e => set('name', e.target.value)}
                  placeholder="e.g. Foxconn, TE Connectivity, Molex"
                  maxLength={150}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Category</label>
                  <select
                    className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400 bg-white"
                    value={form.category}
                    onChange={e => set('category', e.target.value as SupplierCategory)}
                  >
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                  <select
                    className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400 bg-white"
                    value={form.status}
                    onChange={e => set('status', e.target.value as SupplierStatus)}
                  >
                    {Object.entries(STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Contact Name</label>
                  <input
                    className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400"
                    value={form.contactName ?? ''}
                    onChange={e => set('contactName', e.target.value)}
                    placeholder="Name · Title"
                    maxLength={100}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Contact Email</label>
                  <input
                    type="email"
                    className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400"
                    value={form.contactEmail ?? ''}
                    onChange={e => set('contactEmail', e.target.value)}
                    placeholder="supplier@example.com"
                    maxLength={150}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Location</label>
                  <input
                    className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400"
                    value={form.location ?? ''}
                    onChange={e => set('location', e.target.value)}
                    placeholder="City, Country"
                    maxLength={100}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Website</label>
                  <input
                    className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400"
                    value={form.website ?? ''}
                    onChange={e => set('website', e.target.value)}
                    placeholder="https://..."
                    maxLength={200}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Tags</label>
                <input
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400"
                  value={form.tags ?? ''}
                  onChange={e => set('tags', e.target.value)}
                  placeholder="Comma-separated tags: preferred, ISO-certified, dual-source..."
                  maxLength={300}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
                <textarea
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400 resize-none"
                  rows={3}
                  value={form.notes ?? ''}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="General notes, background, initial impression..."
                  maxLength={600}
                />
                <p className="text-right text-[10px] text-slate-400 mt-0.5">{(form.notes ?? '').length}/600</p>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-6">
                <div className="flex-shrink-0">
                  <RadarChart scorecard={form.scorecard ?? DEFAULT_SCORECARD} size={180} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`inline-flex items-baseline gap-1 px-3 py-1 rounded border text-sm font-bold mb-3 ${scoreBg(overall)}`}>
                    <span className={`text-2xl tabular-nums ${scoreColor(overall)}`}>{overall}</span>
                    <span className="text-slate-400 text-xs">/10 overall</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Score each parameter 1–10. Overall = average of all 10 dimensions.
                    Scores feed AI Analysis cross-supplier comparison.
                  </p>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {SCORECARD_PARAMS.map(param => (
                  <ScoreSlider
                    key={param.key}
                    param={param}
                    value={(form.scorecard ?? DEFAULT_SCORECARD)[param.key]}
                    onChange={v => setScore(param.key, v)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name?.trim()}
            className="px-5 py-2 text-sm font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {initial ? 'Save Changes' : 'Add Supplier'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// EventForm modal
// ---------------------------------------------------------------------------
const EMPTY_EVENT = (): Partial<SupplierEvent> => ({
  eventType: 'initial_contact',
  title: '',
  dateMs: Date.now(),
  motivation: '',
  participants: '',
  outcome: '',
  nextSteps: '',
  status: 'planned',
});

interface EventFormProps {
  initial?: SupplierEvent | null;
  onSave: (data: Partial<SupplierEvent>) => Promise<void>;
  onClose: () => void;
}

const EventForm: React.FC<EventFormProps> = ({ initial, onSave, onClose }) => {
  const dateToValue = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const valueToMs  = (v: string) => new Date(v + 'T00:00:00').getTime();

  const [form, setForm] = useState<Partial<SupplierEvent>>(
    initial ? { ...initial } : { ...EMPTY_EVENT(), dateMs: Date.now() }
  );
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title?.trim() || !form.motivation?.trim()) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">
            {initial ? 'Edit Event' : 'Log Event'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Event Type</label>
              <select
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:border-purple-400"
                value={form.eventType}
                onChange={e => set('eventType', e.target.value as SupplierEventType)}
              >
                {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
              <input
                type="date"
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400"
                value={form.dateMs ? dateToValue(form.dateMs) : ''}
                onChange={e => set('dateMs', valueToMs(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Title *</label>
            <input
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400"
              value={form.title ?? ''}
              onChange={e => set('title', e.target.value)}
              placeholder="Short event title..."
              maxLength={150}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Motivation *</label>
            <textarea
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400 resize-none"
              rows={3}
              value={form.motivation ?? ''}
              onChange={e => set('motivation', e.target.value)}
              placeholder="Why is this event happening? What triggered it? What are we trying to learn or decide?"
              maxLength={500}
            />
            <p className="text-right text-[10px] text-slate-400 mt-0.5">{(form.motivation ?? '').length}/500</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Participants</label>
            <input
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400"
              value={form.participants ?? ''}
              onChange={e => set('participants', e.target.value)}
              placeholder="Name — Role, Name — Role, ..."
              maxLength={500}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Outcome</label>
            <textarea
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400 resize-none"
              rows={3}
              value={form.outcome ?? ''}
              onChange={e => set('outcome', e.target.value)}
              placeholder="What was the result? Key findings, decisions made..."
              maxLength={600}
            />
            <p className="text-right text-[10px] text-slate-400 mt-0.5">{(form.outcome ?? '').length}/600</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Next Steps</label>
            <textarea
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-400 resize-none"
              rows={2}
              value={form.nextSteps ?? ''}
              onChange={e => set('nextSteps', e.target.value)}
              placeholder="Follow-up actions, owner, target date..."
              maxLength={400}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Event Status</label>
            <div className="flex gap-2">
              {(['planned', 'completed', 'cancelled'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => set('status', s)}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded border transition-colors capitalize ${
                    form.status === s
                      ? s === 'completed'
                        ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                        : s === 'cancelled'
                        ? 'bg-rose-50 border-rose-400 text-rose-700'
                        : 'bg-purple-50 border-purple-400 text-purple-700'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.title?.trim() || !form.motivation?.trim()}
            className="px-5 py-2 text-sm font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {initial ? 'Save Changes' : 'Log Event'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Supplier detail view — three tabs: Scorecard / Events / Qualification
// ---------------------------------------------------------------------------
type DetailTab = 'scorecard' | 'events' | 'qualification';

interface SupplierDetailProps {
  supplier: Supplier;
  events: SupplierEvent[];
  onEdit: () => void;
  onDelete: () => void;
  onAddEvent: () => void;
  onEditEvent: (ev: SupplierEvent) => void;
  onDeleteEvent: (evId: string) => void;
  onBack: () => void;
}

const SupplierDetail: React.FC<SupplierDetailProps> = ({
  supplier, events, onEdit, onDelete, onAddEvent, onEditEvent, onDeleteEvent, onBack,
}) => {
  const [tab, setTab] = useState<DetailTab>('scorecard');
  const overall = supplier.overallScore;

  const qualEvents = events.filter(e =>
    ['audit', 'qualification_test', 'sample_review'].includes(e.eventType)
  );

  const tabs: Array<{ id: DetailTab; label: string; icon: React.ReactNode }> = [
    { id: 'scorecard',     label: 'Scorecard',     icon: <BarChart3 size={14} /> },
    { id: 'events',        label: `Events (${events.length})`, icon: <Activity size={14} /> },
    { id: 'qualification', label: 'Qualification',  icon: <ClipboardCheck size={14} /> },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Detail header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors"
            >
              <ChevronLeft size={16} />
              All Suppliers
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-purple-600 border border-purple-200 rounded hover:bg-purple-50 transition-colors"
              >
                <Edit2 size={12} />
                Edit
              </button>
              <button
                onClick={onDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 border border-rose-200 rounded hover:bg-rose-50 transition-colors"
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Supplier info card */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-purple-50 border border-purple-200 rounded-lg flex items-center justify-center flex-shrink-0">
                <Building2 size={22} className="text-purple-600" />
              </div>
              <div>
                <h1 className="text-xl font-black text-slate-900 tracking-tight">{supplier.name}</h1>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <span className="text-xs font-semibold text-purple-600 bg-purple-50 border border-purple-200 rounded px-2 py-0.5">
                    {CATEGORY_LABELS[supplier.category]}
                  </span>
                  <span className={`text-xs font-semibold rounded border px-2 py-0.5 ${STATUS_COLORS[supplier.status]}`}>
                    {STATUS_LABELS[supplier.status]}
                  </span>
                  {supplier.tags && supplier.tags.split(',').map(t => t.trim()).filter(Boolean).map(t => (
                    <span key={t} className="text-xs text-slate-500 bg-slate-100 rounded px-2 py-0.5">{t}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className={`text-center px-4 py-2 rounded border ${scoreBg(overall)}`}>
              <p className={`text-3xl font-black tabular-nums ${scoreColor(overall)}`}>{overall}</p>
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mt-0.5">Overall</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-100">
            {supplier.contactName && (
              <div className="flex items-start gap-2">
                <Users size={13} className="text-slate-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Contact</p>
                  <p className="text-xs text-slate-700 font-medium">{supplier.contactName}</p>
                  {supplier.contactEmail && <p className="text-[11px] text-slate-500">{supplier.contactEmail}</p>}
                </div>
              </div>
            )}
            {supplier.location && (
              <div className="flex items-start gap-2">
                <MapPin size={13} className="text-slate-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Location</p>
                  <p className="text-xs text-slate-700 font-medium">{supplier.location}</p>
                </div>
              </div>
            )}
            {supplier.website && (
              <div className="flex items-start gap-2">
                <Globe size={13} className="text-slate-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Website</p>
                  <p className="text-xs text-slate-700 font-medium truncate">{supplier.website.replace(/^https?:\/\//, '')}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-2">
              <Calendar size={13} className="text-slate-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Added</p>
                <p className="text-xs text-slate-700 font-medium">{formatDate(supplier.createdAtMs)}</p>
              </div>
            </div>
          </div>

          {supplier.notes && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-xs text-slate-600 leading-relaxed">{supplier.notes}</p>
            </div>
          )}
        </div>

        {/* Tab strip */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="flex border-b border-slate-100">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-5 py-3 text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-purple-600 text-purple-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5">
            <AnimatePresence mode="wait">
              {tab === 'scorecard' && (
                <motion.div key="scorecard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="flex flex-col md:flex-row gap-8 items-start">
                    <div className="flex-shrink-0">
                      <RadarChart scorecard={supplier.scorecard} size={220} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-slate-800 mb-3">Parameter Breakdown</h3>
                      <div className="space-y-0">
                        {SCORECARD_PARAMS.map(param => {
                          const v = supplier.scorecard[param.key];
                          const pct = (v / 10) * 100;
                          return (
                            <div key={param.key} className="flex items-center gap-3 py-1.5 border-b border-slate-50">
                              <span className="w-40 text-xs font-medium text-slate-700 truncate">{param.label}</span>
                              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${pct}%`,
                                    backgroundColor: v >= 7.5 ? '#10b981' : v >= 5 ? '#f59e0b' : '#ef4444',
                                  }}
                                />
                              </div>
                              <span className={`w-6 text-right text-xs font-bold tabular-nums ${scoreColor(v)}`}>{v}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {tab === 'events' && (
                <motion.div key="events" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs text-slate-500">All interactions with this supplier, most recent first.</p>
                    <button
                      onClick={onAddEvent}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
                    >
                      <Plus size={13} />
                      Log Event
                    </button>
                  </div>

                  {events.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                      <Activity size={28} className="mx-auto mb-2 opacity-40" />
                      <p className="text-sm font-medium">No events yet</p>
                      <p className="text-xs mt-1">Log your first interaction with this supplier.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {events.map(ev => (
                        <div key={ev.id} className="border border-slate-200 rounded-lg p-4 hover:border-purple-200 transition-colors">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-purple-600 bg-purple-50 border border-purple-200 rounded px-2 py-0.5">
                                  {EVENT_TYPE_LABELS[ev.eventType]}
                                </span>
                                <span className={`text-[10px] font-semibold rounded px-2 py-0.5 capitalize ${
                                  ev.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                  ev.status === 'cancelled' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                                  'bg-slate-100 text-slate-600 border border-slate-200'
                                }`}>
                                  {ev.status}
                                </span>
                                <span className="text-[11px] text-slate-400">{formatDate(ev.dateMs)}</span>
                              </div>
                              <p className="text-sm font-semibold text-slate-900">{ev.title}</p>
                              {ev.motivation && (
                                <p className="text-xs text-slate-500 mt-1 leading-relaxed italic">{ev.motivation}</p>
                              )}
                              {ev.participants && (
                                <p className="text-[11px] text-slate-400 mt-1">
                                  <span className="font-medium text-slate-500">Participants: </span>
                                  {ev.participants}
                                </p>
                              )}
                              {ev.outcome && (
                                <div className="mt-2 bg-slate-50 rounded p-2">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Outcome</p>
                                  <p className="text-xs text-slate-700 leading-relaxed">{ev.outcome}</p>
                                </div>
                              )}
                              {ev.nextSteps && (
                                <p className="text-[11px] text-slate-500 mt-2">
                                  <span className="font-semibold">→ Next: </span>
                                  {ev.nextSteps}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              <button
                                onClick={() => onEditEvent(ev)}
                                className="p-1.5 text-slate-400 hover:text-purple-600 transition-colors"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                onClick={() => onDeleteEvent(ev.id)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {tab === 'qualification' && (
                <motion.div key="qualification" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">Qualification Process</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Audits, qualification tests, and sample reviews — the formal gate events that move a supplier from Candidate to Qualified.
                      </p>
                    </div>
                    <button
                      onClick={onAddEvent}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
                    >
                      <Plus size={13} />
                      Add
                    </button>
                  </div>

                  {/* Status track */}
                  <div className="flex items-center gap-0 mb-6 overflow-x-auto pb-1">
                    {(['candidate', 'under_evaluation', 'qualified'] as SupplierStatus[]).map((s, idx, arr) => (
                      <React.Fragment key={s}>
                        <div className={`flex-shrink-0 px-3 py-1.5 rounded text-xs font-semibold border ${
                          supplier.status === s ? STATUS_COLORS[s] : 'bg-slate-50 border-slate-200 text-slate-400'
                        }`}>
                          {STATUS_LABELS[s]}
                        </div>
                        {idx < arr.length - 1 && (
                          <div className="w-6 h-px bg-slate-200 flex-shrink-0 mx-1" />
                        )}
                      </React.Fragment>
                    ))}
                  </div>

                  {/* Qualification events */}
                  {qualEvents.length === 0 ? (
                    <div className="text-center py-10 text-slate-400">
                      <ClipboardCheck size={28} className="mx-auto mb-2 opacity-40" />
                      <p className="text-sm font-medium">No qualification events</p>
                      <p className="text-xs mt-1">Log an Audit, Qualification Test, or Sample Review to track the process.</p>
                    </div>
                  ) : (
                    <div className="relative">
                      {/* Timeline line */}
                      <div className="absolute left-3.5 top-2 bottom-2 w-px bg-slate-200" />
                      <div className="space-y-4">
                        {qualEvents.map(ev => (
                          <div key={ev.id} className="flex gap-4 relative">
                            <div className={`w-7 h-7 rounded-full border-2 flex-shrink-0 flex items-center justify-center z-10 ${
                              ev.status === 'completed' ? 'bg-emerald-50 border-emerald-400' :
                              ev.status === 'cancelled' ? 'bg-rose-50 border-rose-300' :
                              'bg-white border-purple-300'
                            }`}>
                              {ev.status === 'completed' ? (
                                <CheckCircle2 size={14} className="text-emerald-600" />
                              ) : ev.status === 'cancelled' ? (
                                <X size={12} className="text-rose-400" />
                              ) : (
                                <Circle size={12} className="text-purple-400" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0 pb-2">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-xs font-bold text-purple-600">{EVENT_TYPE_LABELS[ev.eventType]}</span>
                                <span className="text-[11px] text-slate-400">{formatDate(ev.dateMs)}</span>
                              </div>
                              <p className="text-sm font-semibold text-slate-900">{ev.title}</p>
                              {ev.outcome && <p className="text-xs text-slate-600 mt-1 leading-relaxed">{ev.outcome}</p>}
                              {ev.nextSteps && <p className="text-[11px] text-slate-500 mt-1 italic">→ {ev.nextSteps}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main SupplierTrackerPage
// ---------------------------------------------------------------------------

const SupplierTrackerPage: React.FC = () => {
  const userId = auth.currentUser?.uid ?? '';

  // Data state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [events, setEvents]       = useState<SupplierEvent[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  // UI state
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [editingSupplier, setEditingSupplier]   = useState<Supplier | null>(null);
  const [showEventForm, setShowEventForm]       = useState(false);
  const [editingEvent, setEditingEvent]         = useState<SupplierEvent | null>(null);
  const [filterStatus, setFilterStatus]         = useState<SupplierStatus | 'all'>('all');
  const [filterCategory, setFilterCategory]     = useState<SupplierCategory | 'all'>('all');
  const [search, setSearch]                     = useState('');

  const selected = useMemo(() => suppliers.find(s => s.id === selectedId) ?? null, [suppliers, selectedId]);
  const selectedEvents = useMemo(
    () => events.filter(e => e.supplierId === selectedId).sort((a, b) => b.dateMs - a.dateMs),
    [events, selectedId]
  );

  // Load suppliers + events
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    const loadAll = async () => {
      try {
        const [supSnap, evSnap] = await Promise.all([
          getDocs(query(collection(db, 'suppliers'), where('userId', '==', userId), orderBy('createdAtMs', 'desc'))),
          getDocs(query(collection(db, 'supplierEvents'), where('userId', '==', userId), orderBy('dateMs', 'desc'))),
        ]);
        setSuppliers(supSnap.docs.map(d => ({ id: d.id, ...d.data() } as Supplier)));
        setEvents(evSnap.docs.map(d => ({ id: d.id, ...d.data() } as SupplierEvent)));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, [userId]);

  // CRUD — suppliers
  const handleSaveSupplier = useCallback(async (data: Partial<Supplier>) => {
    const now = Date.now();
    if (editingSupplier) {
      const ref = doc(db, 'suppliers', editingSupplier.id);
      const payload = { ...data, updatedAtMs: now, updatedAt: serverTimestamp() };
      await updateDoc(ref, payload);
      setSuppliers(prev => prev.map(s => s.id === editingSupplier.id ? { ...s, ...payload } : s));
    } else {
      const payload = {
        ...data,
        userId,
        createdAtMs: now,
        updatedAtMs: now,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, 'suppliers'), payload);
      setSuppliers(prev => [{ id: ref.id, ...payload } as Supplier, ...prev]);
    }
    setShowSupplierForm(false);
    setEditingSupplier(null);
  }, [editingSupplier, userId]);

  const handleDeleteSupplier = useCallback(async (id: string) => {
    if (!confirm('Delete this supplier and all their events? This cannot be undone.')) return;
    await deleteDoc(doc(db, 'suppliers', id));
    // delete their events
    const toDelete = events.filter(e => e.supplierId === id);
    await Promise.all(toDelete.map(e => deleteDoc(doc(db, 'supplierEvents', e.id))));
    setSuppliers(prev => prev.filter(s => s.id !== id));
    setEvents(prev => prev.filter(e => e.supplierId !== id));
    setSelectedId(null);
  }, [events]);

  // CRUD — events
  const handleSaveEvent = useCallback(async (data: Partial<SupplierEvent>) => {
    const now = Date.now();
    if (editingEvent) {
      const ref = doc(db, 'supplierEvents', editingEvent.id);
      const payload = { ...data, updatedAtMs: now, updatedAt: serverTimestamp() };
      await updateDoc(ref, payload);
      setEvents(prev => prev.map(e => e.id === editingEvent.id ? { ...e, ...payload } : e));
    } else {
      const payload = {
        ...data,
        userId,
        supplierId: selectedId!,
        createdAtMs: now,
        updatedAtMs: now,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, 'supplierEvents'), payload);
      setEvents(prev => [{ id: ref.id, ...payload } as SupplierEvent, ...prev]);
    }
    setShowEventForm(false);
    setEditingEvent(null);
  }, [editingEvent, userId, selectedId]);

  const handleDeleteEvent = useCallback(async (evId: string) => {
    if (!confirm('Delete this event?')) return;
    await deleteDoc(doc(db, 'supplierEvents', evId));
    setEvents(prev => prev.filter(e => e.id !== evId));
  }, []);

  // Filtered list
  const filtered = useMemo(() => {
    let list = suppliers;
    if (filterStatus !== 'all') list = list.filter(s => s.status === filterStatus);
    if (filterCategory !== 'all') list = list.filter(s => s.category === filterCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.location ?? '').toLowerCase().includes(q) ||
        (s.tags ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [suppliers, filterStatus, filterCategory, search]);

  // Summary stats
  const stats = useMemo(() => ({
    total:      suppliers.length,
    qualified:  suppliers.filter(s => s.status === 'qualified').length,
    evaluating: suppliers.filter(s => s.status === 'under_evaluation').length,
    avgScore:   suppliers.length
      ? Math.round(suppliers.reduce((acc, s) => acc + s.overallScore, 0) / suppliers.length * 10) / 10
      : 0,
  }), [suppliers]);

  // ---- Render detail ----
  if (selected) {
    return (
      <>
        <SupplierDetail
          supplier={selected}
          events={selectedEvents}
          onEdit={() => { setEditingSupplier(selected); setShowSupplierForm(true); }}
          onDelete={() => handleDeleteSupplier(selected.id)}
          onAddEvent={() => { setEditingEvent(null); setShowEventForm(true); }}
          onEditEvent={(ev) => { setEditingEvent(ev); setShowEventForm(true); }}
          onDeleteEvent={handleDeleteEvent}
          onBack={() => setSelectedId(null)}
        />
        <AnimatePresence>
          {showSupplierForm && (
            <SupplierForm
              initial={editingSupplier}
              onSave={handleSaveSupplier}
              onClose={() => { setShowSupplierForm(false); setEditingSupplier(null); }}
            />
          )}
          {showEventForm && (
            <EventForm
              initial={editingEvent}
              onSave={handleSaveEvent}
              onClose={() => { setShowEventForm(false); setEditingEvent(null); }}
            />
          )}
        </AnimatePresence>
      </>
    );
  }

  // ---- Render list ----
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Page header */}
      <div className="bg-slate-900 border-b border-white/5">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-purple-400 text-[10px] font-black uppercase tracking-[0.35em] mb-1">
                Tool · Supplier Intelligence
              </p>
              <h1 className="text-white text-2xl font-black tracking-tighter uppercase">Supplier Tracker</h1>
              <p className="text-slate-400 text-sm mt-1 font-medium">
                Qualify, score, and track every supplier across the NPI lifecycle.
              </p>
            </div>
            <button
              onClick={() => { setEditingSupplier(null); setShowSupplierForm(true); }}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-sm font-black uppercase tracking-wide bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors"
            >
              <Plus size={16} />
              Add Supplier
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mt-6">
            {[
              { label: 'Total',       value: stats.total,     color: 'text-white' },
              { label: 'Qualified',   value: stats.qualified, color: 'text-emerald-400' },
              { label: 'Evaluating',  value: stats.evaluating,color: 'text-amber-400' },
              { label: 'Avg Score',   value: stats.avgScore,  color: 'text-purple-400' },
            ].map(s => (
              <div key={s.label} className="bg-white/5 border border-white/10 rounded-lg px-4 py-3">
                <p className={`text-2xl font-black tabular-nums ${s.color}`}>{s.value}</p>
                <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-wide mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search suppliers..."
            className="flex-1 min-w-48 border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400"
          />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as SupplierStatus | 'all')}
            className="border border-slate-200 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-purple-400"
          >
            <option value="all">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value as SupplierCategory | 'all')}
            className="border border-slate-200 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-purple-400"
          >
            <option value="all">All Categories</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      {/* List */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 size={24} className="animate-spin mr-2" />
            Loading suppliers...
          </div>
        ) : error ? (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-sm text-rose-700">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 text-slate-400">
            <Truck size={36} className="mx-auto mb-3 opacity-30" />
            <p className="text-base font-semibold text-slate-600">
              {suppliers.length === 0 ? 'No suppliers yet' : 'No suppliers match your filters'}
            </p>
            <p className="text-sm mt-1">
              {suppliers.length === 0
                ? 'Add your first supplier to start the qualification process.'
                : 'Try adjusting your search or filters.'}
            </p>
            {suppliers.length === 0 && (
              <button
                onClick={() => { setEditingSupplier(null); setShowSupplierForm(true); }}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
              >
                <Plus size={14} />
                Add First Supplier
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map(sup => {
              const evCount = events.filter(e => e.supplierId === sup.id).length;
              return (
                <motion.div
                  key={sup.id}
                  layoutId={`supplier-${sup.id}`}
                  onClick={() => setSelectedId(sup.id)}
                  whileHover={{ y: -1 }}
                  className="bg-white border border-slate-200 rounded-lg p-4 cursor-pointer hover:border-purple-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-purple-600 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5">
                          {CATEGORY_LABELS[sup.category]}
                        </span>
                        <span className={`text-[10px] font-semibold border rounded px-1.5 py-0.5 ${STATUS_COLORS[sup.status]}`}>
                          {STATUS_LABELS[sup.status]}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 truncate">{sup.name}</h3>
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400">
                        {sup.location && (
                          <span className="flex items-center gap-1">
                            <MapPin size={10} />
                            {sup.location}
                          </span>
                        )}
                        {evCount > 0 && (
                          <span className="flex items-center gap-1">
                            <Activity size={10} />
                            {evCount} event{evCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={`text-center px-3 py-1.5 rounded border flex-shrink-0 ${scoreBg(sup.overallScore)}`}>
                      <p className={`text-lg font-black tabular-nums ${scoreColor(sup.overallScore)}`}>{sup.overallScore}</p>
                      <p className="text-[9px] text-slate-400 font-semibold">/10</p>
                    </div>
                  </div>

                  {/* Mini radar */}
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex-1 grid grid-cols-5 gap-1">
                      {SCORECARD_PARAMS.slice(0, 5).map(p => (
                        <div key={p.key} title={p.label} className="flex flex-col items-center gap-0.5">
                          <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(sup.scorecard[p.key] / 10) * 100}%`,
                                backgroundColor: sup.scorecard[p.key] >= 7.5 ? '#10b981' : sup.scorecard[p.key] >= 5 ? '#f59e0b' : '#ef4444',
                              }}
                            />
                          </div>
                          <span className="text-[8px] text-slate-400 truncate w-full text-center">{p.label.split(' ')[0]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showSupplierForm && (
          <SupplierForm
            initial={editingSupplier}
            onSave={handleSaveSupplier}
            onClose={() => { setShowSupplierForm(false); setEditingSupplier(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default SupplierTrackerPage;
