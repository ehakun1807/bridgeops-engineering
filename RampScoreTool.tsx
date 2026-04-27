
import React, { useState, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import { db } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { sendEmailNotification } from './notify';
import { PRODUCT_SEGMENTS } from './productSegments.ts';
import {
  STANDARDS_BY_SEGMENT,
  type Standard
} from './productStandards.ts';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Download,
  HelpCircle,
  Loader2,
  Mail,
  Rocket,
  Send,
  ShieldAlert,
  TrendingUp,
  ChevronLeft,
  Settings,
  BarChart3,
  ChevronDown,
  X,
  ShieldCheck
} from 'lucide-react';

const Tooltip: React.FC<{ text: string }> = ({ text }) => {
  const [show, setShow] = useState(false);
  
  return (
    <div className="relative inline-block ml-1.5 align-middle">
      <div 
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="cursor-help text-slate-400 hover:text-blue-600 transition-colors"
      >
        <HelpCircle size={12} />
      </div>
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-900 text-white text-[10px] font-medium rounded shadow-xl pointer-events-none text-center leading-relaxed"
          >
            {text}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900"></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

interface KPI {
  category: string;
  metric: string;
  description: string;
  target: string;
}

// Risks / recommendations carry a short title (headline) plus a longer
// detail paragraph so the printed audit reads like a real deliverable.
interface RiskItem {
  title: string;
  detail: string;
}

interface RecommendationItem {
  title: string;
  detail: string;
}

interface AssessmentResult {
  score: number;
  riskLevel: string;
  risks: RiskItem[];
  recommendations: RecommendationItem[];
  analysis: string;
  kpis: KPI[];
}

// Normalizes AI output so old string[] responses still render correctly,
// and both object and string entries end up in { title, detail } shape.
const normalizeRiskItems = (raw: any[]): RiskItem[] =>
  (raw || []).map((r) => {
    if (typeof r === 'string') return { title: r, detail: '' };
    return { title: r?.title ?? '', detail: r?.detail ?? '' };
  });

const normalizeRecItems = (raw: any[]): RecommendationItem[] =>
  (raw || []).map((r) => {
    if (typeof r === 'string') return { title: r, detail: '' };
    return { title: r?.title ?? '', detail: r?.detail ?? '' };
  });

interface RampScoreToolProps {
  onNavigate?: import('./types').NavigateFn;
}

// ---------------------------------------------------------------------------
// Parameter schema — richer than the original 10-indicator version. Each entry
// describes how it's rendered (slider / select / number), where it sits in the
// form (section), what it contributes to the rollup score, and the help text.
// ---------------------------------------------------------------------------

type ParamSection = 'context' | 'operational' | 'supply';
type ParamKind = 'slider' | 'select' | 'number';

interface ParamOption {
  value: string;
  label: string;
  score: number; // 0-100 contribution when this option is chosen
}

interface Parameter {
  id: string;
  label: string;
  help: string;
  kind: ParamKind;
  section: ParamSection;
  // For select
  options?: ParamOption[];
  // For number
  min?: number;
  max?: number;
  placeholder?: string;
  // Default value for initial state
  defaultValue: number | string;
  // Whether this parameter contributes to the rollup readiness score
  scored: boolean;
  // Weight (default 1); higher = greater impact on rollup
  weight?: number;
  // For number inputs, mapping from raw number to 0-100 score
  numberToScore?: (n: number) => number;
}

// Bucketed score for supplier count — more diversification = better resilience.
const suppliersToScore = (n: number): number => {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 3) return 30;
  if (n < 6) return 55;
  if (n < 11) return 75;
  if (n < 21) return 88;
  return 95;
};

// Bucketed score for monthly volume — higher volume = more proven ramp.
const volumeToScore = (n: number): number => {
  if (!Number.isFinite(n) || n <= 0) return 20;
  if (n < 100) return 35;
  if (n < 500) return 55;
  if (n < 2000) return 70;
  if (n < 10000) return 82;
  return 92;
};

const PARAMETERS: Parameter[] = [
  // --- Product Context ---
  {
    id: 'complexity', label: 'Complexity', section: 'context', kind: 'select',
    help: 'Overall design & integration complexity of the product.',
    defaultValue: 'Medium', scored: true, weight: 1,
    options: [
      { value: 'Low',    label: 'Low',    score: 90 },
      { value: 'Medium', label: 'Medium', score: 60 },
      { value: 'High',   label: 'High',   score: 30 }
    ]
  },
  {
    id: 'supplyChain', label: 'Supply Chain', section: 'context', kind: 'select',
    help: 'Geographic profile of the supply base — local is lower-risk than global.',
    defaultValue: 'Mixed', scored: true, weight: 1,
    options: [
      { value: 'Domestic', label: 'Domestic', score: 92 },
      { value: 'Regional', label: 'Regional', score: 75 },
      { value: 'Mixed',    label: 'Mixed',    score: 55 },
      { value: 'Global',   label: 'Global',   score: 35 }
    ]
  },
  {
    id: 'ecoGovernance', label: 'ECO Governance', section: 'context', kind: 'select',
    help: 'How Engineering Change Orders are managed — formal workflows reduce revision drift.',
    defaultValue: 'Loose/Manual', scored: true, weight: 1.2,
    options: [
      { value: 'Loose/Manual', label: 'Loose / Manual', score: 30 },
      { value: 'Semi-Formal',  label: 'Semi-Formal',    score: 60 },
      { value: 'Formal',       label: 'Formal',         score: 85 },
      { value: 'Automated',    label: 'Automated (PLM)', score: 100 }
    ]
  },

  // --- Operational Readiness (sliders) ---
  {
    id: 'dmrCompleteness', label: 'DMR Completeness', section: 'operational', kind: 'slider',
    help: 'Device Master Record — completeness of manufacturing documentation.',
    defaultValue: 50, scored: true, weight: 1.2
  },
  {
    id: 'testability', label: 'Product Testability Coverage', section: 'operational', kind: 'slider',
    help: 'Percentage of critical specs covered by production test procedures.',
    defaultValue: 50, scored: true, weight: 1.2
  },
  {
    id: 'secondSource', label: 'Critical Components — Second Source', section: 'operational', kind: 'slider',
    help: 'Percentage of critical components with a qualified alternate supplier.',
    defaultValue: 50, scored: true, weight: 1
  },
  {
    id: 'mfgMaturity', label: 'Manufacturing Maturity', section: 'operational', kind: 'slider',
    help: 'Readiness of line, tooling, workstations, and operator training.',
    defaultValue: 50, scored: true, weight: 1.3
  },
  {
    id: 'designMaturity', label: 'Product Design Maturity', section: 'operational', kind: 'slider',
    help: 'Design freeze, BOM stability, and release-to-production readiness.',
    defaultValue: 50, scored: true, weight: 1.3
  },

  // --- Volume & Supply Base (numeric) ---
  {
    id: 'numSuppliers', label: 'Number of Suppliers', section: 'supply', kind: 'number',
    help: 'Total qualified suppliers in the active BOM. Higher diversity reduces concentration risk.',
    defaultValue: 10, min: 0, placeholder: '10', scored: true, weight: 0.8,
    numberToScore: suppliersToScore
  },
  {
    id: 'monthlyVolume', label: 'Monthly Volume (units)', section: 'supply', kind: 'number',
    help: 'Expected monthly production volume at ramp. Informs capacity & yield exposure.',
    defaultValue: 1000, min: 0, placeholder: '1000', scored: true, weight: 0.6,
    numberToScore: volumeToScore
  }
];

// Convert any parameter's current value to a 0-100 score.
const scoreForParameter = (p: Parameter, value: number | string): number => {
  if (p.kind === 'slider') return Math.max(0, Math.min(100, Number(value) || 0));
  if (p.kind === 'select') {
    const opt = p.options?.find(o => o.value === value);
    return opt ? opt.score : 0;
  }
  if (p.kind === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return p.numberToScore ? p.numberToScore(n) : Math.max(0, Math.min(100, n));
  }
  return 0;
};

const SECTION_META: Record<ParamSection, { label: string; subtitle: string }> = {
  context:     { label: 'Product Context',      subtitle: 'What you are building and the regulatory environment.' },
  operational: { label: 'Operational Readiness', subtitle: 'Maturity of documentation, testing, and manufacturing.' },
  supply:      { label: 'Volume & Supply Base',  subtitle: 'Operational scale and supplier diversification.' }
};

// --- Visual helpers ---------------------------------------------------------

// Color buckets for scores. Red = critical, amber = warning, blue = on-track, green = strong.
const scoreColor = (v: number): { stroke: string; fill: string; text: string; bg: string; label: string } => {
  if (v >= 80) return { stroke: '#16a34a', fill: '#22c55e', text: 'text-green-600', bg: 'bg-green-600', label: 'STRONG' };
  if (v >= 60) return { stroke: '#2563eb', fill: '#3b82f6', text: 'text-blue-600', bg: 'bg-blue-600', label: 'ON TRACK' };
  if (v >= 40) return { stroke: '#d97706', fill: '#f59e0b', text: 'text-amber-600', bg: 'bg-amber-500', label: 'WARNING' };
  return { stroke: '#dc2626', fill: '#ef4444', text: 'text-red-600', bg: 'bg-red-600', label: 'CRITICAL' };
};

// Counter that smoothly animates from 0 to `value` — used inside the score gauge.
const AnimatedCounter: React.FC<{ value: number; duration?: number; className?: string }> = ({
  value,
  duration = 1.6,
  className = ''
}) => {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => Math.round(latest));
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const controls = animate(count, value, { duration, ease: [0.22, 1, 0.36, 1] });
    const unsub = rounded.on('change', (v) => setDisplay(v));
    return () => {
      controls.stop();
      unsub();
    };
  }, [value, duration]);

  return <span className={className}>{display}</span>;
};

// Radial progress gauge — animates stroke-dashoffset from full circle down to the target value.
const ScoreGauge: React.FC<{ score: number; size?: number }> = ({ score, size = 260 }) => {
  const stroke = 18;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const colors = scoreColor(score);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        {/* Progress */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.stroke}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - (circumference * score) / 100 }}
          transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 12px ${colors.stroke}80)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-[9px] font-black uppercase tracking-[0.4em] text-white/50 mb-1">Readiness</p>
        <div className="text-7xl font-black tracking-tighter text-white leading-none">
          <AnimatedCounter value={score} />
          <span className="text-3xl align-top ml-1">%</span>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.6, duration: 0.4 }}
          className={`mt-3 px-4 py-1 text-white text-[10px] font-black uppercase tracking-[0.3em] ${colors.bg}`}
        >
          {colors.label}
        </motion.div>
      </div>
    </div>
  );
};

// Horizontal animated bar used for per-indicator breakdown.
const ScoreBar: React.FC<{ label: string; value: number; index: number }> = ({ label, value, index }) => {
  const colors = scoreColor(value);
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06 + 0.2, duration: 0.4 }}
      className="group"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">
          {index + 1}. {label}
        </span>
        <span className={`text-sm font-black tracking-tight ${colors.text}`}>
          <AnimatedCounter value={value} duration={1.2} />%
        </span>
      </div>
      <div className="relative h-2.5 bg-slate-100 overflow-hidden rounded-sm">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ delay: index * 0.06 + 0.25, duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-y-0 left-0 rounded-sm"
          style={{
            background: `linear-gradient(90deg, ${colors.fill}, ${colors.stroke})`,
            boxShadow: `0 0 12px ${colors.fill}50`
          }}
        />
        {/* Shine sweep */}
        <motion.div
          initial={{ x: '-100%' }}
          animate={{ x: '200%' }}
          transition={{ delay: index * 0.06 + 1.2, duration: 1.0, ease: 'easeOut' }}
          className="absolute inset-y-0 left-0 w-1/3"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)'
          }}
        />
      </div>
    </motion.div>
  );
};

// Live running score shown on the form as parameters are adjusted.
const LiveScoreBar: React.FC<{ score: number }> = ({ score }) => {
  const colors = scoreColor(score);
  return (
    <div className="sticky top-20 z-30 bg-white/95 backdrop-blur border border-slate-200 rounded-sm shadow-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <BarChart3 size={14} className="text-blue-600" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">
            Live Readiness — {colors.label}
          </span>
        </div>
        <span className={`text-lg font-black tracking-tight ${colors.text}`}>
          {score}%
        </span>
      </div>
      <div className="relative h-2 bg-slate-100 overflow-hidden rounded-sm">
        <motion.div
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-y-0 left-0 rounded-sm"
          style={{
            background: `linear-gradient(90deg, ${colors.fill}, ${colors.stroke})`,
            boxShadow: `0 0 10px ${colors.fill}60`
          }}
        />
      </div>
    </div>
  );
};

// Custom slider control — native range input with an animated blue fill,
// score badge on the right, and optional help tooltip.
const Slider: React.FC<{
  label: string;
  help?: string;
  value: number;
  onChange: (v: number) => void;
}> = ({ label, help, value, onChange }) => {
  const colors = scoreColor(value);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center">
          {label}
          {help && <Tooltip text={help} />}
        </label>
        <span className={`text-sm font-black tracking-tight ${colors.text}`}>{value}%</span>
      </div>
      <div className="relative h-2 bg-slate-100 rounded-full overflow-visible">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full pointer-events-none"
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          style={{
            background: `linear-gradient(90deg, ${colors.fill}, ${colors.stroke})`,
            boxShadow: `0 0 8px ${colors.fill}60`
          }}
        />
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          aria-label={label}
        />
        <motion.div
          animate={{ left: `calc(${value}% - 9px)` }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="absolute top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full border-2 border-white pointer-events-none"
          style={{
            backgroundColor: colors.stroke,
            boxShadow: `0 2px 8px ${colors.fill}80`
          }}
        />
      </div>
    </div>
  );
};

// Styled select — wraps a native <select> for accessibility while matching the form's aesthetic.
const SelectInput: React.FC<{
  label: string;
  help?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}> = ({ label, help, value, options, onChange }) => (
  <div>
    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 flex items-center">
      {label}
      {help && <Tooltip text={help} />}
    </label>
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-slate-50 border border-slate-200 p-3.5 pr-10 text-slate-900 focus:border-blue-500 outline-none font-bold text-sm cursor-pointer hover:border-slate-300 transition-colors"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  </div>
);

// Numeric input with label + help + unit suffix support.
const NumberField: React.FC<{
  label: string;
  help?: string;
  value: number;
  placeholder?: string;
  min?: number;
  onChange: (v: number) => void;
}> = ({ label, help, value, placeholder, min, onChange }) => (
  <div>
    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 flex items-center">
      {label}
      {help && <Tooltip text={help} />}
    </label>
    <input
      type="number"
      inputMode="numeric"
      min={min}
      value={Number.isFinite(value) ? value : ''}
      placeholder={placeholder}
      onChange={(e) => {
        const n = e.target.value === '' ? 0 : Number(e.target.value);
        onChange(Number.isFinite(n) ? n : 0);
      }}
      className="w-full bg-slate-50 border border-slate-200 p-3.5 text-slate-900 focus:border-blue-500 outline-none font-bold text-sm hover:border-slate-300 transition-colors"
    />
  </div>
);

// Section heading used to group parameters on the form.
const SectionHeader: React.FC<{ number: number; title: string; subtitle: string }> = ({ number, title, subtitle }) => (
  <div className="mb-6">
    <div className="flex items-center gap-3 mb-2">
      <div className="w-8 h-8 bg-blue-600 text-white font-black text-xs flex items-center justify-center rounded-sm">
        {number}
      </div>
      <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">{title}</h3>
    </div>
    <p className="text-slate-500 text-xs font-medium leading-relaxed ml-11">{subtitle}</p>
  </div>
);

// ---------------------------------------------------------------------------

const RampScoreTool: React.FC<RampScoreToolProps> = ({ onNavigate }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [standardsOpen, setStandardsOpen] = useState(false);

  // Lead-capture state: user can submit their email from the result screen
  // to receive a follow-up PDF audit. Saved to Firestore `leads` collection.
  const [leadEmail, setLeadEmail] = useState('');
  const [leadStatus, setLeadStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle');

  // Build initial parameter values from the PARAMETERS schema defaults.
  const initialParams: Record<string, number | string> = PARAMETERS.reduce((acc, p) => {
    acc[p.id] = p.defaultValue;
    return acc;
  }, {} as Record<string, number | string>);

  const [formData, setFormData] = useState({
    companyName: '',
    productType: PRODUCT_SEGMENTS[0],
    standards: [] as string[],
    params: initialParams
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    // When the product segment changes, clear previously selected standards
    // because they are segment-specific.
    if (name === 'productType') {
      setFormData(prev => ({ ...prev, productType: value, standards: [] }));
      setStandardsOpen(false);
      return;
    }
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const toggleStandard = (code: string) => {
    setFormData(prev => ({
      ...prev,
      standards: prev.standards.includes(code)
        ? prev.standards.filter(s => s !== code)
        : [...prev.standards, code]
    }));
  };

  const clearStandards = () => {
    setFormData(prev => ({ ...prev, standards: [] }));
  };

  const availableStandards: Standard[] = STANDARDS_BY_SEGMENT[formData.productType] || [];

  const submitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = leadEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setLeadStatus('error');
      return;
    }
    setLeadStatus('submitting');

    // Run email delivery and Firestore backup in parallel — succeed as long
    // as the email goes through, since that's the primary delivery channel.
    const emailPromise = sendEmailNotification({
      subject: `New Ramp Audit Request — ${formData.companyName || 'Unnamed'}`,
      replyTo: trimmed,
      fields: {
        'Requester Email': trimmed,
        'Company': formData.companyName || '—',
        'Product Segment': formData.productType,
        'Standards Selected': formData.standards.length > 0 ? formData.standards.join(', ') : '—',
        'Readiness Score': result?.score != null ? `${result.score}%` : '—',
        'Risk Level': result?.riskLevel ?? '—',
        'Top Risks': result?.risks?.map(r => r.title).join(' | ') ?? '—',
        'Recommendations': result?.recommendations?.map(r => r.title).join(' | ') ?? '—',
        'Source': 'ramp_score_result',
        'Submitted At': new Date().toISOString()
      }
    });

    const firestorePromise = addDoc(collection(db, 'leads'), {
      email: trimmed,
      source: 'ramp_score_result',
      companyName: formData.companyName,
      productType: formData.productType,
      standards: formData.standards,
      score: result?.score ?? null,
      riskLevel: result?.riskLevel ?? null,
      createdAt: serverTimestamp()
    }).catch(err => {
      // Firestore failure is non-fatal — rules may not be deployed yet.
      console.warn('Firestore lead write failed (non-fatal):', err);
      return null;
    });

    const [emailOk] = await Promise.all([emailPromise, firestorePromise]);
    setLeadStatus(emailOk ? 'sent' : 'error');
  };

  const setParam = (id: string, value: number | string) => {
    setFormData(prev => ({
      ...prev,
      params: { ...prev.params, [id]: value }
    }));
  };

  // Weighted average over all scored parameters, clamped to 0-100.
  const calculateScore = () => {
    let total = 0;
    let weights = 0;
    PARAMETERS.filter(p => p.scored).forEach(p => {
      const v = formData.params[p.id];
      const s = scoreForParameter(p, v as any);
      const w = p.weight ?? 1;
      total += s * w;
      weights += w;
    });
    return weights > 0 ? Math.round(total / weights) : 0;
  };

  // Per-parameter score breakdown used on the result screen.
  const parameterBreakdown = () =>
    PARAMETERS.filter(p => p.scored).map(p => ({
      id: p.id,
      label: p.label,
      rawValue: formData.params[p.id],
      value: scoreForParameter(p, formData.params[p.id] as any)
    }));

  const runAssessment = async () => {
    if (!formData.companyName) {
      alert("Please enter a company or project name.");
      return;
    }
    const avg = calculateScore();
    setLoading(true);
    try {
      const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;

      const standardsLine = formData.standards.length > 0
        ? `Applicable Standards / Regulations: ${formData.standards.join(', ')}. Weigh compliance-readiness against each of these standards when assessing risk and recommendations.`
        : `Applicable Standards / Regulations: None selected. Flag the absence of explicit compliance targets as a contributing risk factor.`;

      // Build a human-readable parameter snapshot grouped by section.
      const lineFor = (p: Parameter) => {
        const raw = formData.params[p.id];
        const s = scoreForParameter(p, raw as any);
        if (p.kind === 'select') return `${p.label}: ${raw} (score ${s})`;
        if (p.kind === 'number') return `${p.label}: ${raw} (derived score ${s})`;
        return `${p.label}: ${s}%`;
      };
      const context = PARAMETERS.filter(p => p.section === 'context').map(lineFor).join('; ');
      const ops = PARAMETERS.filter(p => p.section === 'operational').map(lineFor).join('; ');
      const supply = PARAMETERS.filter(p => p.section === 'supply').map(lineFor).join('; ');

      const analysisPrompt = `You are a senior NPI / operations engineering advisor producing a written audit for a hardware-startup executive. The tone is authoritative, concrete, and grounded in industry practice (IATF 16949, ISO 13485, AS9100, IEC 61508 etc. where relevant).

Context — assess manufacturing ramp readiness for ${formData.companyName} (${formData.productType}).
Weighted Readiness Score: ${avg}%
Product Context: ${context}
Operational Readiness: ${ops}
Volume & Supply Base: ${supply}
${standardsLine}

Produce the following:

(1) riskLevel — one of LOW / MEDIUM / HIGH.

(2) risks — exactly 3 items, each with:
    - title: a short risk headline (max 10 words), referencing a concrete value from the data (e.g. "Only 10 suppliers — concentration exposure on critical BOM").
    - detail: 3-5 sentences explaining why this risk matters for *this* company, the likely operational impact during ramp (line-down events, yield loss, schedule slip with rough magnitude), and the specific parameter / standard that makes it a risk. Reference the selected standards where relevant.

(3) recommendations — exactly 3 items, each with:
    - title: a short actionable headline (max 10 words) using an imperative verb (e.g. "Qualify dual-source alternates for top 10 critical components").
    - detail: 3-5 sentences giving (a) the concrete first step, (b) expected timeframe / effort, (c) the metric or standard to verify completion, (d) expected risk reduction. Tie each recommendation back to one of the risks above.

(4) analysis — 2-3 sentence executive summary referencing the most material weaknesses and the likely ramp-readiness verdict.`;

      if (apiKey) {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: "gemini-flash-latest",
          contents: analysisPrompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                score: { type: Type.NUMBER },
                riskLevel: { type: Type.STRING },
                risks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      detail: { type: Type.STRING }
                    },
                    required: ["title", "detail"]
                  }
                },
                recommendations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      detail: { type: Type.STRING }
                    },
                    required: ["title", "detail"]
                  }
                },
                analysis: { type: Type.STRING },
                kpis: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { category: {type: Type.STRING}, metric: {type: Type.STRING}, target: {type: Type.STRING}, description: {type: Type.STRING} } } }
              },
              required: ["score", "riskLevel", "risks", "recommendations", "analysis"]
            }
          }
        });
        const data = JSON.parse(response.text);
        setResult({
          ...data,
          score: avg,
          risks: normalizeRiskItems(data.risks),
          recommendations: normalizeRecItems(data.recommendations),
          kpis: data.kpis || []
        });
      } else {
        throw new Error("No API Key");
      }
    } catch (err) {
      // Offline / no-API fallback. Keeps the same { title, detail } shape as
      // the AI path so the rendering code doesn't have to branch.
      setResult({
        score: avg,
        riskLevel: avg > 80 ? 'LOW' : avg > 60 ? 'MEDIUM' : 'HIGH',
        risks: [
          {
            title: 'Readiness gaps in core operational pillars',
            detail: 'Several of the lowest-scoring parameters — in particular Manufacturing Maturity, DMR Completeness and Product Design Maturity — sit below the 60% on-track threshold. Entering ramp with these gaps typically produces line-down events in the first 4-8 weeks of production, yield loss in the 10-25% range on early builds, and a schedule slip of 4-6 weeks while the team stabilizes the process.'
          },
          {
            title: 'Supply-chain stability needs validation',
            detail: 'With the current supply-chain profile and supplier count, concentration risk on critical components is material. A single allocation, quality escape, or logistics disruption can halt the line. The downstream impact is measured in missed customer commitments and costly expedites that erode gross margin.'
          },
          {
            title: 'Test coverage insufficient for scale',
            detail: 'Production test coverage below 70% generally correlates with field-return rates 2-3x above industry benchmarks and with warranty reserve pressure in the first year of shipment. For regulated segments the gap also weakens the evidence base needed for the applicable standards and can delay regulatory clearances.'
          }
        ],
        recommendations: [
          {
            title: 'Deep-dive audit on bottom-3 parameters within 30 days',
            detail: 'Commission a focused operational audit targeted on the three lowest-scoring parameters in this snapshot. Deliverables should include a gap register, a 90-day closure plan with named owners, and a pre/post score. Expect a 10-20 point readiness improvement in the targeted areas and a measurable reduction in ramp-phase risk.'
          },
          {
            title: 'Qualify dual-source alternates for top-10 critical components',
            detail: 'Run a BOM criticality analysis, isolate the top-10 single-sourced parts, and start qualification of alternates in parallel. Target first-article approval within 8-12 weeks. Track progress against a supplier-diversification KPI and re-score this parameter at closure. This directly addresses the supply-chain risk above and is a common audit expectation for AS9100 / IATF 16949 / ISO 13485 supply chains.'
          },
          {
            title: 'Lift production test coverage to ≥85% of critical specs',
            detail: 'Map every critical-to-quality spec to a production test step. Close uncovered specs with either automated testers, manual checks with go/no-go limits, or inspection gates. Validate through 1-week line shadow and a capability study. Expect a step-change reduction in escapes and a meaningful improvement in first-pass yield — key evidence for any process-audit standard (IATF 16949 clause 7.1.5, ISO 13485 clause 7.5.6).'
          }
        ],
        analysis: 'Offline snapshot — full AI-generated narrative unavailable. The score is based on product context, operational readiness and supply-base inputs. Lower-scoring parameters point to specific ramp-phase exposures that should be closed before committing to full production volume.',
        kpis: []
      });
    } finally {
      setLoading(false);
    }
  };

  const renderForm = () => (
    <div className="max-w-4xl mx-auto space-y-12 pb-20">
      <div className="text-center space-y-4 mb-20 pt-10">
        <h2 className="text-5xl font-black text-slate-900 uppercase tracking-tighter italic">
          BridgeOps Ramp Readiness <span className="text-blue-600">Snapshot</span>
        </h2>
        <p className="text-slate-500 font-bold uppercase tracking-[0.3em] text-[11px]">Free Manufacturing Maturity Diagnostic Tool</p>
      </div>

      <div className="bg-white p-12 border border-slate-200 rounded-sm shadow-2xl space-y-10 text-left">
        {/* Section 1: Identification & Regulatory */}
        <div>
          <SectionHeader
            number={1}
            title="Project Identification"
            subtitle="Name your project, pick a segment, and flag the standards that apply."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Company / Project Name</label>
              <input
                name="companyName"
                value={formData.companyName}
                onChange={handleInputChange}
                placeholder="e.g., AeroDynamics Ltd"
                className="w-full bg-slate-50 border border-slate-200 p-3.5 text-slate-900 focus:border-blue-500 outline-none font-bold text-sm hover:border-slate-300 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Product Category</label>
              <div className="relative">
                <select
                  name="productType"
                  value={formData.productType}
                  onChange={handleInputChange}
                  className="w-full appearance-none bg-slate-50 border border-slate-200 p-3.5 pr-10 text-slate-900 focus:border-blue-500 outline-none font-bold text-sm cursor-pointer hover:border-slate-300 transition-colors"
                >
                  {PRODUCT_SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>
          </div>
        </div>

        {/* ISO / World-Standards selector — contextual to chosen segment.
            Selections are passed to the AI so the readiness score reflects
            compliance-readiness against the standards that apply to the product. */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center">
              <ShieldCheck size={12} className="mr-2 text-blue-600" />
              Applicable Standards &amp; Regulations
              <Tooltip text="Select all ISO / world standards that apply to your product. The risk engine uses these to weight the readiness score." />
            </label>
            {formData.standards.length > 0 && (
              <button
                type="button"
                onClick={clearStandards}
                className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-red-600 flex items-center transition-colors"
              >
                <X size={10} className="mr-1" /> Clear ({formData.standards.length})
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setStandardsOpen(o => !o)}
            className="w-full bg-slate-50 border border-slate-200 p-4 text-left focus:border-blue-500 outline-none font-black uppercase tracking-widest text-[10px] text-slate-900 flex items-center justify-between hover:border-blue-300 transition-colors"
          >
            <span className={formData.standards.length === 0 ? 'text-slate-400' : 'text-slate-900'}>
              {formData.standards.length === 0
                ? `Select standards relevant to ${formData.productType}`
                : `${formData.standards.length} Standard${formData.standards.length > 1 ? 's' : ''} Selected`}
            </span>
            <ChevronDown
              size={14}
              className={`text-slate-500 transition-transform ${standardsOpen ? 'rotate-180' : ''}`}
            />
          </button>

          <AnimatePresence>
            {standardsOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-2 border border-slate-200 bg-white max-h-72 overflow-y-auto divide-y divide-slate-100">
                  {availableStandards.map(std => {
                    const checked = formData.standards.includes(std.code);
                    return (
                      <label
                        key={std.code}
                        className={`flex items-start gap-3 p-3 cursor-pointer transition-colors ${
                          checked ? 'bg-blue-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStandard(std.code)}
                          className="mt-1 h-4 w-4 accent-blue-600 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-black uppercase tracking-widest text-slate-900">
                            {std.code}
                          </div>
                          <div className="text-[11px] font-medium text-slate-500 leading-snug">
                            {std.name}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {formData.standards.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {formData.standards.map(code => (
                <span
                  key={code}
                  className="inline-flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 text-[9px] font-black uppercase tracking-widest"
                >
                  {code}
                  <button
                    type="button"
                    onClick={() => toggleStandard(code)}
                    className="hover:text-blue-200"
                    aria-label={`Remove ${code}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Live running readiness — updates as any parameter changes. */}
        <div className="pt-4">
          <LiveScoreBar score={calculateScore()} />
        </div>

        {/* Section 2: Product Context (complexity, supply chain, ECO governance) */}
        <div className="pt-6 border-t border-slate-100">
          <SectionHeader
            number={2}
            title="Product Context"
            subtitle={SECTION_META.context.subtitle}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PARAMETERS.filter(p => p.section === 'context' && p.kind === 'select').map(p => (
              <SelectInput
                key={p.id}
                label={p.label}
                help={p.help}
                value={formData.params[p.id] as string}
                options={p.options!.map(o => ({ value: o.value, label: o.label }))}
                onChange={(v) => setParam(p.id, v)}
              />
            ))}
          </div>
        </div>

        {/* Section 3: Operational Readiness (sliders) */}
        <div className="pt-8 border-t border-slate-100">
          <SectionHeader
            number={3}
            title="Operational Readiness"
            subtitle={SECTION_META.operational.subtitle}
          />
          <div className="space-y-7">
            {PARAMETERS.filter(p => p.section === 'operational').map(p => (
              <Slider
                key={p.id}
                label={p.label}
                help={p.help}
                value={formData.params[p.id] as number}
                onChange={(v) => setParam(p.id, v)}
              />
            ))}
          </div>
        </div>

        {/* Section 4: Volume & Supply Base (numeric) */}
        <div className="pt-8 border-t border-slate-100">
          <SectionHeader
            number={4}
            title="Volume & Supply Base"
            subtitle={SECTION_META.supply.subtitle}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {PARAMETERS.filter(p => p.section === 'supply').map(p => (
              <NumberField
                key={p.id}
                label={p.label}
                help={p.help}
                value={formData.params[p.id] as number}
                placeholder={p.placeholder}
                min={p.min}
                onChange={(v) => setParam(p.id, v)}
              />
            ))}
          </div>
        </div>

        <button
          onClick={runAssessment}
          disabled={loading || !formData.companyName.trim()}
          className="w-full bg-slate-900 text-white py-6 font-black uppercase tracking-[0.4em] text-sm hover:bg-blue-600 transition-all disabled:opacity-50 flex items-center justify-center group shadow-2xl"
        >
          {loading ? <Loader2 className="animate-spin mr-3" /> : <TrendingUp className="mr-3" />}
          Generate Readiness Score
        </button>
      </div>
    </div>
  );

  const renderResult = () => {
    if (!result) return null;

    // Per-parameter breakdown from the unified schema — each parameter
    // contributes a normalized 0-100 value regardless of input type.
    const indicatorBreakdown = parameterBreakdown();

    return (
      <div id="report-content" className="max-w-6xl mx-auto space-y-12 pb-20">
        {/* Print-only header — shown on the PDF / printout only. */}
        <div className="print-only hidden print:block border-b-2 border-slate-900 pb-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-600 mb-1">
                BridgeOps.ENGINEERING
              </p>
              <p className="text-[11px] font-bold text-slate-700">
                Ramp Readiness Snapshot — Confidential Audit
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Prepared</p>
              <p className="text-[11px] font-bold text-slate-900">
                {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
        </div>

        {/* HERO — animated circular gauge + executive summary */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="bg-slate-900 p-10 md:p-16 text-white text-left relative overflow-hidden rounded-sm"
        >
          <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
          {/* Ambient glow */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 1 }}
            className="absolute -top-32 -right-32 w-96 h-96 rounded-full"
            style={{
              background: `radial-gradient(circle, ${scoreColor(result.score).stroke}40 0%, transparent 70%)`
            }}
          />

          <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-10 items-center">
            <div className="md:col-span-5 flex justify-center">
              <ScoreGauge score={Math.round(result.score)} size={280} />
            </div>
            <div className="md:col-span-7">
              <motion.p
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="text-blue-400 font-black uppercase tracking-[0.4em] text-[10px] mb-4"
              >
                BridgeOps Readiness Snapshot
              </motion.p>
              <motion.h2
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-2 leading-none"
              >
                {formData.companyName}
              </motion.h2>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-slate-500 font-black uppercase tracking-widest text-[10px] mb-6"
              >
                {formData.productType}
                {formData.standards.length > 0 && ` · ${formData.standards.length} Standard${formData.standards.length > 1 ? 's' : ''}`}
              </motion.p>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-slate-300 font-medium text-base md:text-lg leading-relaxed mb-8"
              >
                {result.analysis}
              </motion.p>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="flex flex-wrap gap-4 no-print"
              >
                <button
                  onClick={() => window.print()}
                  className="bg-white text-slate-900 px-8 py-4 font-black uppercase tracking-widest text-[10px] hover:bg-blue-50 transition-all flex items-center shadow-xl"
                >
                  <Download className="mr-3" size={16} /> Download Audit PDF
                </button>
                <button
                  onClick={() => {
                    setResult(null);
                    setLeadStatus('idle');
                    setLeadEmail('');
                  }}
                  className="bg-transparent border border-white/20 text-white px-8 py-4 font-black uppercase tracking-widest text-[10px] hover:bg-white/10 transition-all"
                >
                  Retake Diagnostic
                </button>
              </motion.div>
            </div>
          </div>
        </motion.div>

        {/* PER-INDICATOR BREAKDOWN — animated horizontal bars */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-white p-10 md:p-12 border border-slate-200 rounded-sm shadow-xl"
        >
          <div className="flex items-center justify-between mb-10 gap-6 flex-wrap">
            <div>
              <p className="text-blue-600 font-black uppercase tracking-[0.3em] text-[10px] mb-2">Diagnostic Breakdown</p>
              <h3 className="text-2xl md:text-3xl font-black text-slate-900 uppercase tracking-tighter">
                10-Parameter Readiness Profile
              </h3>
            </div>
            <div className="flex items-center gap-6 text-[9px] font-black uppercase tracking-widest">
              <span className="flex items-center gap-2"><div className="w-3 h-3 bg-green-500 rounded-sm"></div>Strong</span>
              <span className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-500 rounded-sm"></div>On Track</span>
              <span className="flex items-center gap-2"><div className="w-3 h-3 bg-amber-500 rounded-sm"></div>Warning</span>
              <span className="flex items-center gap-2"><div className="w-3 h-3 bg-red-500 rounded-sm"></div>Critical</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-5">
            {indicatorBreakdown.map((ind, idx) => (
              <ScoreBar key={ind.id} label={ind.label} value={ind.value} index={idx} />
            ))}
          </div>
        </motion.div>

        {/* RISKS + RECOMMENDATIONS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="bg-white p-10 md:p-12 border border-slate-200 rounded-sm shadow-xl text-left"
          >
            <h3 className="text-xl font-black uppercase tracking-tighter mb-8 flex items-center text-red-600">
              <ShieldAlert className="mr-3" size={24} /> Critical Risk Drivers
            </h3>
            <div className="space-y-5">
              {result.risks.map((risk, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.1 }}
                  className="flex items-start space-x-4 p-5 bg-red-50/50 border-l-4 border-red-500 print:break-inside-avoid"
                >
                  <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-[13px] font-black text-slate-900 leading-snug uppercase tracking-tight">
                      {risk.title}
                    </p>
                    {risk.detail && (
                      <p className="text-[13px] font-medium text-slate-600 leading-relaxed">
                        {risk.detail}
                      </p>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="bg-white p-10 md:p-12 border border-slate-200 rounded-sm shadow-xl text-left"
          >
            <h3 className="text-xl font-black uppercase tracking-tighter mb-8 flex items-center text-blue-600">
              <ClipboardCheck className="mr-3" size={24} /> Strategic Next Steps
            </h3>
            <div className="space-y-5">
              {result.recommendations.map((rec, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.1 }}
                  className="flex items-start space-x-4 p-5 bg-blue-50/50 border-l-4 border-blue-500 print:break-inside-avoid"
                >
                  <CheckCircle2 size={18} className="text-blue-500 flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-[13px] font-black text-slate-900 leading-snug uppercase tracking-tight">
                      {rec.title}
                    </p>
                    {rec.detail && (
                      <p className="text-[13px] font-medium text-slate-600 leading-relaxed">
                        {rec.detail}
                      </p>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Print-only footer block — branding + contact on printed audit. */}
        <div className="print-only hidden print:block border-t-2 border-slate-900 pt-4 mt-4 text-[10px] text-slate-600 leading-snug">
          <div className="flex items-start justify-between gap-8">
            <div>
              <p className="font-black uppercase tracking-widest text-slate-900 mb-1">
                BridgeOps.ENGINEERING
              </p>
              <p>Eran Hakun — NPI & Operations Engineering Advisory</p>
              <p>eran@bridgeops-engineering.com · Israel | Global Operations</p>
            </div>
            <div className="text-right">
              <p className="font-black uppercase tracking-widest text-slate-900 mb-1">
                Confidential
              </p>
              <p>Generated by the Ramp Readiness Snapshot diagnostic tool.</p>
              <p>For detailed audit, contact eran@bridgeops-engineering.com.</p>
            </div>
          </div>
        </div>

        {/* LEAD CAPTURE — converts anonymous users into reachable contacts. */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="relative bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-10 md:p-14 rounded-sm shadow-2xl overflow-hidden no-print"
        >
          <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
          <motion.div
            animate={{ opacity: [0.3, 0.5, 0.3] }}
            transition={{ duration: 4, repeat: Infinity }}
            className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-blue-600/20 blur-3xl"
          />

          <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-10 items-center">
            <div className="md:col-span-7">
              <p className="text-blue-400 font-black uppercase tracking-[0.4em] text-[10px] mb-4">
                Get the Full Audit Report
              </p>
              <h3 className="text-3xl md:text-4xl font-black text-white uppercase tracking-tighter mb-4 leading-tight">
                Want a deeper <span className="text-blue-500 italic">look?</span>
              </h3>
              <p className="text-slate-400 font-medium text-base leading-relaxed max-w-xl">
                Leave your email and I'll send you the complete PDF audit — including benchmarking against peers
                in your segment, a prioritized action roadmap, and compliance notes for the standards you selected.
                No spam, no upsell.
              </p>
            </div>

            <div className="md:col-span-5">
              <AnimatePresence mode="wait">
                {leadStatus !== 'sent' ? (
                  <motion.form
                    key="form"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onSubmit={submitLead}
                    className="space-y-3"
                  >
                    <div className="relative">
                      <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        value={leadEmail}
                        onChange={(e) => {
                          setLeadEmail(e.target.value);
                          if (leadStatus === 'error') setLeadStatus('idle');
                        }}
                        placeholder="you@company.com"
                        required
                        className="w-full bg-white/10 backdrop-blur border border-white/20 focus:border-blue-500 outline-none text-white placeholder:text-slate-500 pl-11 pr-4 py-4 font-medium text-sm rounded-sm"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={leadStatus === 'submitting'}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 font-black uppercase tracking-[0.3em] text-[11px] transition-all disabled:opacity-60 flex items-center justify-center shadow-xl shadow-blue-500/30"
                    >
                      {leadStatus === 'submitting' ? (
                        <><Loader2 className="animate-spin mr-3" size={14} /> Sending</>
                      ) : (
                        <><Send className="mr-3" size={14} /> Send My Audit</>
                      )}
                    </button>
                    {leadStatus === 'error' && (
                      <p className="text-red-400 text-[11px] font-black uppercase tracking-widest text-center">
                        Invalid email — please try again
                      </p>
                    )}
                    <p className="text-slate-500 text-[10px] font-medium leading-relaxed text-center pt-1">
                      Your data stays private. Audit delivered within 24h.
                    </p>
                  </motion.form>
                ) : (
                  <motion.div
                    key="sent"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-green-600/10 border border-green-500/30 p-6 rounded-sm text-center"
                  >
                    <CheckCircle2 size={32} className="text-green-500 mx-auto mb-3" />
                    <p className="text-white font-black uppercase tracking-widest text-sm mb-2">Got it</p>
                    <p className="text-slate-400 text-xs font-medium leading-relaxed">
                      Your audit will land in your inbox shortly.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>
    );
  };

  return (
    <div className="pt-12 px-4 sm:px-6 lg:px-8">
      {!result ? renderForm() : renderResult()}
    </div>
  );
};


export default RampScoreTool;
