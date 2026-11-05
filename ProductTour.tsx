// ---------------------------------------------------------------------------
// ProductTour — interactive platform walkthrough for the Intelligence page.
//
// Five "screens" showing realistic in-code mockups of key platform moments:
//   1. Dashboard — RAMP score portfolio view
//   2. AI Analysis — cross-tool risk + action output
//   3. Activity Feed — real-time event stream
//   4. PFMEA — risk matrix with RPN
//   5. Review Studio — gate package generation
//
// No screenshots needed — built from the platform's own visual language.
// ---------------------------------------------------------------------------

import React, { useState, useEffect } from 'react';
import {
  Brain,
  Activity,
  ShieldAlert,
  Presentation,
  LayoutDashboard,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Zap,
  ArrowRight,
  TrendingUp,
  FileWarning,
  Scale,
  Lightbulb,
  Boxes,
  Users,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared mini-components reused across screens
// ---------------------------------------------------------------------------

function ScoreBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-slate-400 w-20 shrink-0 uppercase tracking-wider">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-bold text-slate-300 w-6 text-right">{pct}%</span>
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${color}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Screen 1 — Dashboard
// ---------------------------------------------------------------------------
function ScreenDashboard() {
  const projects = [
    { name: 'FMI · Spine Delivery System', score: 74, gate: 'CDR', trend: '+6', status: 'at_risk', tools: ['PFMEA', 'BOM', 'Takt'] },
    { name: 'Brain.space · EEG Headset Rev3', score: 61, gate: 'PDR', trend: '+11', status: 'on_track', tools: ['PFMEA', 'Decisions'] },
    { name: 'IoT Gateway · v2 Hardware', score: 88, gate: 'PRR', trend: '+3', status: 'on_track', tools: ['Control Plan', 'BOM'] },
  ];
  return (
    <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
      {/* nav bar */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">BridgeOps Intelligence</span>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-[9px] text-blue-400 font-semibold">Live</span>
        </div>
      </div>
      {/* header */}
      <div className="px-4 pt-3 pb-2 border-b border-slate-800/60">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-blue-500 font-black">BridgeOps Intelligence</p>
            <h3 className="text-white font-bold text-sm">Program Workspace</h3>
            <p className="text-slate-500 text-[10px]">3 Active · 0 Archived</p>
          </div>
          <button className="text-[9px] bg-blue-600 text-white px-2.5 py-1.5 rounded font-semibold">+ New Project</button>
        </div>
      </div>
      {/* project list */}
      <div className="px-4 py-3 flex flex-col gap-2">
        {projects.map((p) => (
          <div key={p.name} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <div>
                <p className="text-xs font-semibold text-white leading-tight">{p.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Chip label={p.gate} color="bg-sky-900/50 border-sky-700 text-sky-400" />
                  <Chip
                    label={p.status === 'on_track' ? 'On Track' : 'At Risk'}
                    color={p.status === 'on_track'
                      ? 'bg-emerald-900/40 border-emerald-700 text-emerald-400'
                      : 'bg-amber-900/40 border-amber-700 text-amber-400'}
                  />
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-black text-white leading-none">{p.score}%</div>
                <div className="text-[9px] text-emerald-400 font-semibold">{p.trend} this week</div>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-wrap mt-1">
              {p.tools.map(t => (
                <span key={t} className="text-[8px] bg-slate-800 text-slate-400 rounded px-1.5 py-0.5">{t}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 2 — AI Analysis output
// ---------------------------------------------------------------------------
function ScreenAIAnalysis() {
  const risks = [
    { flag: 'Supplier qualification gap at CDR+1', source: 'Supplier Tracker · CM unqualified', severity: 'high' as const },
    { flag: 'PFMEA risk NCR-004 has no CAPA defined', source: 'NCR Tracker · Critical · Solder bridging', severity: 'high' as const },
    { flag: 'BOM rev bump post-CDR — re-qual cost unknown', source: 'ECO Pulse · 7 changed lines · 2 supplier swaps', severity: 'medium' as const },
    { flag: 'Decision reversed: assembly process changed', source: 'Decision Ledger · Design churn signal', severity: 'medium' as const },
  ];
  const actions = [
    { title: 'Qualify CM supplier before PRR gate', impact: 'high' as const },
    { title: 'Define CAPA for solder-bridging NCR-004', impact: 'high' as const },
    { title: 'Run cost + lead-time delta on BOM rev B2', impact: 'medium' as const },
    { title: 'Update PFMEA to reflect assembly process change', impact: 'medium' as const },
    { title: 'Schedule Takt study re-run after process update', impact: 'low' as const },
  ];
  return (
    <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={12} className="text-blue-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">AI Analysis · Full Project Scan</span>
        </div>
        <Chip label="8 signals read" color="bg-blue-900/40 border-blue-700 text-blue-400" />
      </div>
      {/* snapshot */}
      <div className="bg-slate-900/60 border-b border-slate-800/60 px-4 py-2.5">
        <p className="text-[11px] text-slate-300 italic">
          "CDR approaching with an unqualified CM, an open CAPA gap, and a post-CDR BOM change — three converging risks need immediate resolution."
        </p>
      </div>
      <div className="grid grid-cols-2 gap-0 divide-x divide-slate-800">
        {/* risks */}
        <div className="px-4 py-3">
          <p className="text-[9px] uppercase tracking-widest text-slate-500 font-black mb-2">Risks Flagged</p>
          <div className="flex flex-col gap-2">
            {risks.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${r.severity === 'high' ? 'bg-rose-500' : 'bg-amber-500'}`} />
                <div>
                  <p className="text-[10px] text-slate-200 font-medium leading-tight">{r.flag}</p>
                  <p className="text-[9px] text-slate-500">{r.source}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* actions */}
        <div className="px-4 py-3">
          <p className="text-[9px] uppercase tracking-widest text-slate-500 font-black mb-2">Top Actions</p>
          <div className="flex flex-col gap-2">
            {actions.map((a, i) => (
              <div key={i} className="flex items-start gap-2">
                <ChevronRight size={10} className={`mt-0.5 shrink-0 ${
                  a.impact === 'high' ? 'text-rose-400' : a.impact === 'medium' ? 'text-amber-400' : 'text-slate-500'
                }`} />
                <p className="text-[10px] text-slate-300 leading-tight">{a.title}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 3 — Activity Feed
// ---------------------------------------------------------------------------
function ScreenActivityFeed() {
  const events = [
    { tool: 'NCR Tracker',    color: 'bg-rose-500',    icon: FileWarning, title: 'NCR logged: NCR-004',         detail: 'CRITICAL · Solder bridging · In-process',       high: true,  mins: 2  },
    { tool: 'ECO Pulse',      color: 'bg-amber-500',   icon: Boxes,       title: 'BOM uploaded — Rev B2',        detail: '7 changed, 2 supplier swaps · Reason: cost opt',high: true,  mins: 14 },
    { tool: 'Decision Ledger',color: 'bg-indigo-500',  icon: Scale,       title: 'Decision reversed',            detail: 'Assembly process changed — design churn signal',high: true,  mins: 47 },
    { tool: 'PFMEA',          color: 'bg-rose-400',    icon: ShieldAlert, title: 'High-RPN risk flagged',        detail: 'Solder bridging RPN 280 · 3 failure modes',     high: false, mins: 52 },
    { tool: 'Meetings',       color: 'bg-violet-500',  icon: Users,       title: 'Meeting logged: CDR pre-read', detail: 'External · 6 attendees · 4 action items',       high: false, mins: 90 },
    { tool: 'AI Analysis',    color: 'bg-blue-500',    icon: Brain,       title: 'Full project scan complete',   detail: '8 signals read · 4 risks · 5 actions',          high: false, mins: 95 },
    { tool: 'Lessons',        color: 'bg-teal-500',    icon: Lightbulb,   title: 'Lesson created',               detail: 'Supplier · CAPA in progress · 2 MUST actions',  high: false, mins: 120},
  ];
  return (
    <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-emerald-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">Activity Feed</span>
        </div>
        <select className="text-[9px] bg-slate-800 border border-slate-700 text-slate-400 rounded px-1.5 py-0.5">
          <option>All tools</option>
        </select>
      </div>
      <div className="px-4 py-3 flex flex-col gap-0">
        {events.map((e, i) => {
          const Icon = e.icon;
          return (
            <div key={i} className={`flex items-start gap-2.5 py-2 ${i < events.length - 1 ? 'border-b border-slate-800/50' : ''} ${e.high ? 'bg-amber-500/5 -mx-4 px-4 rounded' : ''}`}>
              <div className="relative shrink-0 mt-0.5">
                <div className={`w-5 h-5 rounded ${e.color} bg-opacity-20 flex items-center justify-center`}>
                  <Icon size={9} className="text-white opacity-80" />
                </div>
                {i < events.length - 1 && (
                  <div className="absolute left-2.5 top-5 w-px h-full bg-slate-800" style={{ height: 'calc(100% + 4px)' }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[9px] font-semibold`} style={{ color: e.color.replace('bg-','').includes('500') ? undefined : undefined }}>{e.tool}</span>
                  {e.high && <Chip label="High signal" color="bg-amber-900/40 border-amber-700 text-amber-400" />}
                  <span className="text-[9px] text-slate-600 ml-auto shrink-0">
                    {e.mins < 60 ? `${e.mins}m ago` : `${Math.round(e.mins/60)}h ago`}
                  </span>
                </div>
                <p className="text-[10px] text-slate-300 font-medium">{e.title}</p>
                <p className="text-[9px] text-slate-500 truncate">{e.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 4 — PFMEA
// ---------------------------------------------------------------------------
function ScreenPFMEA() {
  const risks = [
    { step: 'Reflow soldering', mode: 'Solder bridging', effect: 'Short circuit / field failure', s: 9, o: 6, d: 5, ap: 'H' },
    { step: 'Press-fit connector', mode: 'Insufficient insertion force', effect: 'Intermittent connection', s: 7, o: 4, d: 4, ap: 'H' },
    { step: 'Conformal coat', mode: 'Coating void', effect: 'Moisture ingress / corrosion', s: 6, o: 3, d: 5, ap: 'M' },
    { step: 'Final inspection', mode: 'Visual escape', effect: 'Non-conforming unit ships', s: 8, o: 2, d: 6, ap: 'M' },
  ];
  return (
    <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert size={12} className="text-rose-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-rose-400">PFMEA · AIAG-VDA 2019</span>
        </div>
        <span className="text-[9px] text-slate-400">4 risks · Max RPN 270</span>
      </div>
      {/* summary chips */}
      <div className="px-4 py-2 border-b border-slate-800/50 flex gap-2">
        <Chip label="2 High AP" color="bg-rose-900/40 border-rose-700 text-rose-400" />
        <Chip label="2 Medium AP" color="bg-amber-900/40 border-amber-700 text-amber-400" />
        <Chip label="Max RPN 270" color="bg-slate-800 border-slate-700 text-slate-400" />
      </div>
      {/* table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[9px]">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="px-3 py-1.5 text-left text-slate-500 font-semibold uppercase tracking-wider">Process Step</th>
              <th className="px-3 py-1.5 text-left text-slate-500 font-semibold uppercase tracking-wider">Failure Mode</th>
              <th className="px-2 py-1.5 text-center text-slate-500 font-semibold">S</th>
              <th className="px-2 py-1.5 text-center text-slate-500 font-semibold">O</th>
              <th className="px-2 py-1.5 text-center text-slate-500 font-semibold">D</th>
              <th className="px-2 py-1.5 text-center text-slate-500 font-semibold">RPN</th>
              <th className="px-2 py-1.5 text-center text-slate-500 font-semibold">AP</th>
            </tr>
          </thead>
          <tbody>
            {risks.map((r, i) => {
              const rpn = r.s * r.o * r.d;
              const tier = rpn > 100 ? 'high' : rpn > 40 ? 'medium' : 'low';
              return (
                <tr key={i} className={`border-b border-slate-800/40 ${tier === 'high' ? 'bg-rose-500/5' : ''}`}>
                  <td className="px-3 py-2 text-slate-300 font-medium">{r.step}</td>
                  <td className="px-3 py-2 text-slate-400">{r.mode}</td>
                  <td className="px-2 py-2 text-center text-slate-300 font-mono">{r.s}</td>
                  <td className="px-2 py-2 text-center text-slate-300 font-mono">{r.o}</td>
                  <td className="px-2 py-2 text-center text-slate-300 font-mono">{r.d}</td>
                  <td className="px-2 py-2 text-center font-bold font-mono">
                    <span className={tier === 'high' ? 'text-rose-400' : tier === 'medium' ? 'text-amber-400' : 'text-slate-400'}>
                      {rpn}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span className={`font-black text-[10px] ${r.ap === 'H' ? 'text-rose-400' : 'text-amber-400'}`}>{r.ap}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Yamazumi mini-chart */}
      <div className="px-4 py-3 border-t border-slate-800/50">
        <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-2">RPN Distribution</p>
        <div className="flex items-end gap-1 h-8">
          {risks.map((r, i) => {
            const rpn = r.s * r.o * r.d;
            const h = Math.round((rpn / 280) * 100);
            const color = rpn > 100 ? 'bg-rose-500' : rpn > 40 ? 'bg-amber-500' : 'bg-slate-600';
            return <div key={i} className={`flex-1 rounded-sm ${color}`} style={{ height: `${h}%` }} title={`${r.step}: ${rpn}`} />;
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 5 — Review Studio
// ---------------------------------------------------------------------------
function ScreenReviewStudio() {
  const reviews = [
    { title: 'CDR Pre-read', type: 'Gate Review', date: 'Oct 28', outcome: 'approved_with_conditions', failItems: 2, mustPending: 3 },
    { title: 'TRR — Test Strategy Alignment', type: 'Test Readiness', date: 'Nov 1', outcome: 'pending', failItems: 0, mustPending: 0 },
  ];
  const outcomeColor: Record<string, string> = {
    approved_with_conditions: 'bg-amber-900/40 border-amber-700 text-amber-400',
    pending: 'bg-slate-800 border-slate-700 text-slate-400',
    approved: 'bg-emerald-900/40 border-emerald-700 text-emerald-400',
    needs_rework: 'bg-rose-900/40 border-rose-700 text-rose-400',
  };
  const outcomeLabel: Record<string, string> = {
    approved_with_conditions: 'Approved w/ Conditions',
    pending: 'Pending',
    approved: 'Approved',
    needs_rework: 'Needs Rework',
  };
  return (
    <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Presentation size={12} className="text-sky-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-sky-400">Review Studio</span>
        </div>
        <button className="text-[9px] bg-sky-600 text-white px-2.5 py-1 rounded font-semibold">+ New Review</button>
      </div>
      <div className="px-4 py-3 flex flex-col gap-2">
        {reviews.map((r, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-white">{r.title}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <Chip label={r.type} color="bg-sky-900/40 border-sky-700 text-sky-400" />
                  <Chip label={outcomeLabel[r.outcome]} color={outcomeColor[r.outcome]} />
                </div>
              </div>
              <span className="text-[9px] text-slate-500 shrink-0">{r.date}</span>
            </div>
            {r.failItems > 0 && (
              <div className="mt-2 flex gap-2">
                <span className="text-[9px] bg-rose-900/30 border border-rose-800 text-rose-400 rounded px-1.5 py-0.5">
                  {r.failItems} fail items
                </span>
                <span className="text-[9px] bg-amber-900/30 border border-amber-800 text-amber-400 rounded px-1.5 py-0.5">
                  {r.mustPending} open MUST actions
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Generate package CTA */}
      <div className="mx-4 mb-4 bg-slate-900/80 border border-sky-900/50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[10px] font-bold text-sky-400 uppercase tracking-wider">Generate Review Package</p>
            <p className="text-[9px] text-slate-400 mt-0.5">PPTX deck from live project data · 9 slides auto-built</p>
          </div>
          <Zap size={16} className="text-sky-500" />
        </div>
        <div className="grid grid-cols-3 gap-1 mb-3">
          {['Program Status', 'Top Risks', 'Key Decisions', 'BOM Status', 'Mfg Readiness', 'Open Actions'].map(s => (
            <div key={s} className="bg-slate-800 rounded px-1.5 py-1 text-[8px] text-slate-400 text-center">{s}</div>
          ))}
        </div>
        <button className="w-full text-[10px] bg-sky-600 hover:bg-sky-700 text-white py-2 rounded-lg font-semibold flex items-center justify-center gap-1.5">
          <Presentation size={11} /> Generate PPTX Package
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tour config
// ---------------------------------------------------------------------------
const TOUR_STEPS = [
  {
    id: 'dashboard',
    icon: LayoutDashboard,
    label: 'Program Workspace',
    headline: 'All programs. One readiness number.',
    body: 'Every project shows its live RAMP score, current gate, and which tools have activity — without opening anything.',
    screen: ScreenDashboard,
    accent: 'blue',
  },
  {
    id: 'ai',
    icon: Brain,
    label: 'AI Analysis',
    headline: 'One scan reads every tool at once.',
    body: 'AI Analysis reads PFMEA, BOM changes, decisions, NCRs, and meetings together — surfaces what matters before your gate review, not during it.',
    screen: ScreenAIAnalysis,
    accent: 'blue',
  },
  {
    id: 'feed',
    icon: Activity,
    label: 'Activity Feed',
    headline: 'Nothing happens without a trace.',
    body: 'Every tool action — risk logged, BOM uploaded, decision reversed — flows into a single project timeline. High-signal events are flagged automatically.',
    screen: ScreenActivityFeed,
    accent: 'emerald',
  },
  {
    id: 'pfmea',
    icon: ShieldAlert,
    label: 'PFMEA',
    headline: 'AIAG-VDA risk analysis. Built in.',
    body: 'Severity, Occurrence, Detection with full anchor scales. AP computed live. AI Analysis reads every risk — so a high-RPN gap you forgot about surfaces in the next scan.',
    screen: ScreenPFMEA,
    accent: 'rose',
  },
  {
    id: 'review',
    icon: Presentation,
    label: 'Review Studio',
    headline: 'Gate-ready PPTX in one click.',
    body: 'Log design reviews (DR, TRR, CDR, PRR), track open actions, and generate a full review deck from live project data — RAMP scores, risks, decisions, BOM status, budget — no manual assembly.',
    screen: ScreenReviewStudio,
    accent: 'sky',
  },
];

const ACCENT_CLASSES: Record<string, { active: string; ring: string; dot: string; text: string; bg: string }> = {
  blue:    { active: 'border-blue-500 bg-blue-500/10',    ring: 'ring-blue-500/30',    dot: 'bg-blue-500',    text: 'text-blue-400',    bg: 'bg-blue-500' },
  emerald: { active: 'border-emerald-500 bg-emerald-500/10', ring: 'ring-emerald-500/30', dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500' },
  rose:    { active: 'border-rose-500 bg-rose-500/10',    ring: 'ring-rose-500/30',    dot: 'bg-rose-500',    text: 'text-rose-400',    bg: 'bg-rose-500' },
  sky:     { active: 'border-sky-500 bg-sky-500/10',      ring: 'ring-sky-500/30',     dot: 'bg-sky-500',     text: 'text-sky-400',     bg: 'bg-sky-500' },
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export default function ProductTour() {
  const [active, setActive] = useState(0);
  const [animating, setAnimating] = useState(false);

  const step = TOUR_STEPS[active];
  const accent = ACCENT_CLASSES[step.accent];
  const Screen = step.screen;

  function go(idx: number) {
    if (idx === active || animating) return;
    setAnimating(true);
    setTimeout(() => {
      setActive(idx);
      setAnimating(false);
    }, 150);
  }

  // Auto-advance every 6 seconds
  useEffect(() => {
    const t = setInterval(() => {
      setActive(i => (i + 1) % TOUR_STEPS.length);
    }, 6000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="bg-slate-950 py-24 relative overflow-hidden border-t border-slate-800">
      <div className="absolute inset-0 blueprint-grid-dark opacity-10" />
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Section header */}
        <div className="flex items-center space-x-2 mb-4">
          <div className="w-10 h-[1px] bg-blue-600" />
          <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">Platform Walkthrough</span>
        </div>
        <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
          <h2 className="text-3xl md:text-5xl font-black text-white tracking-tighter uppercase leading-tight">
            See it in action.
          </h2>
          <p className="text-slate-400 text-sm max-w-sm leading-relaxed">
            12 integrated tools. One AI scan. Everything connected — from first part to production.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">

          {/* Left — step list */}
          <div className="flex flex-col gap-2">
            {TOUR_STEPS.map((s, i) => {
              const a = ACCENT_CLASSES[s.accent];
              const isActive = i === active;
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  onClick={() => go(i)}
                  className={`w-full text-left rounded-xl border px-4 py-3.5 transition-all duration-200 ${
                    isActive
                      ? `${a.active} ring-1 ${a.ring}`
                      : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isActive ? a.bg : 'bg-slate-800'
                    }`}>
                      <Icon size={13} className={isActive ? 'text-white' : 'text-slate-400'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold leading-tight ${isActive ? 'text-white' : 'text-slate-300'}`}>
                        {s.label}
                      </p>
                      {isActive && (
                        <p className="text-[10px] text-slate-400 mt-0.5 leading-snug line-clamp-2">
                          {s.headline}
                        </p>
                      )}
                    </div>
                    {isActive && <ChevronRight size={12} className={a.text} />}
                  </div>
                  {/* progress bar */}
                  {isActive && (
                    <div className="mt-2.5 h-0.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        key={`${active}-bar`}
                        className={`h-full ${a.bg} rounded-full`}
                        style={{
                          animation: 'progress-fill 6s linear forwards',
                        }}
                      />
                    </div>
                  )}
                </button>
              );
            })}

            {/* Nav arrows */}
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => go((active - 1 + TOUR_STEPS.length) % TOUR_STEPS.length)}
                className="flex-1 flex items-center justify-center gap-1 text-[10px] text-slate-400 hover:text-white border border-slate-800 hover:border-slate-600 rounded-lg py-2 transition-all"
              >
                <ChevronLeft size={12} /> Prev
              </button>
              <button
                onClick={() => go((active + 1) % TOUR_STEPS.length)}
                className="flex-1 flex items-center justify-center gap-1 text-[10px] text-slate-400 hover:text-white border border-slate-800 hover:border-slate-600 rounded-lg py-2 transition-all"
              >
                Next <ChevronRight size={12} />
              </button>
            </div>

            {/* Step dots */}
            <div className="flex items-center justify-center gap-1.5 mt-1">
              {TOUR_STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => go(i)}
                  className={`rounded-full transition-all ${
                    i === active ? `w-4 h-1.5 ${ACCENT_CLASSES[TOUR_STEPS[i].accent].dot}` : 'w-1.5 h-1.5 bg-slate-700 hover:bg-slate-500'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Right — screen mockup */}
          <div
            className={`transition-all duration-150 ${animating ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}`}
          >
            {/* caption */}
            <div className="mb-4">
              <p className={`text-lg font-black text-white tracking-tight ${accent.text}`}>
                {step.headline}
              </p>
              <p className="text-slate-400 text-sm mt-1 max-w-xl leading-relaxed">{step.body}</p>
            </div>
            <Screen />
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mt-14 text-center">
          <p className="text-slate-500 text-sm mb-4">
            12 tools. All connected. One AI that reads them together.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-6 text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
            {['PFMEA', 'ECO Pulse', 'NCR Tracker', 'Decision Ledger', 'Takt Studies', 'Review Studio', 'Control Plan', 'Budget Tracker', 'Process Map', 'Lessons & Learned', 'SOP Radar', 'Supplier Tracker'].map(t => (
              <span key={t} className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-blue-600 inline-block" />{t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* CSS for progress bar animation */}
      <style>{`
        @keyframes progress-fill {
          from { width: 0%; }
          to   { width: 100%; }
        }
      `}</style>
    </section>
  );
}
