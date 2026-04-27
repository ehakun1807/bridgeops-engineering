// ---------------------------------------------------------------------------
// BridgeOps Academy — informative content for users of the tool. The layout
// is a two-column scaffold (subject list on the left, selected subject on
// the right) so new subjects can be added without touching the shell.
//
// First subject: "Gate Map" — a horizontal process diagram of the six
// industry-standard stage gates (CR → PDR → CDR → TRR → PRR → MP) with a
// short, industry-neutral description per gate so the reader can orient
// regardless of whether their program follows MIL-STD-1521, NASA SE, IATF
// 16949, or an internal equivalent.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  GraduationCap,
  Map as MapIcon,
  ChevronRight,
  Compass
} from 'lucide-react';
import type { ProductGate } from './ProjectDeepDive';

// ---------------------------------------------------------------------------
// Gate Map content
// ---------------------------------------------------------------------------

// Short, industry-neutral descriptions. Terminology deliberately avoids any
// single-industry vocabulary so Space / Military / Medical / Agriculture /
// IoT / Industrial programs all read naturally here.
interface GateInfo {
  id: ProductGate;
  name: string;
  oneLiner: string;
  description: string;
  // Accent tokens — just enough color to visually separate the cards.
  ring: string;
  chipBg: string;
  chipText: string;
  dotBg: string;
  barGradient: string;
}

const GATES: GateInfo[] = [
  {
    id: 'CR',
    name: 'Concept Review',
    oneLiner: 'Problem, market, and top-level requirements are understood.',
    description:
      'The team confirms the opportunity is real, scopes the problem, and captures top-level requirements before any detailed design begins. Exit criteria typically include a business case, a concept of operations, and preliminary requirements baselined for traceability.',
    ring: 'ring-slate-300',
    chipBg: 'bg-slate-100',
    chipText: 'text-slate-800',
    dotBg: 'bg-slate-500',
    barGradient: 'from-slate-300 to-slate-500'
  },
  {
    id: 'PDR',
    name: 'Preliminary Design Review',
    oneLiner: 'Chosen approach can meet performance, cost, and schedule.',
    description:
      'An architecture has been selected and shown to meet requirements with acceptable risk. Major interfaces, long-lead items, make-vs-buy decisions, and critical analyses (thermal, structural, power, safety, etc.) are reviewed. After PDR the team can commit capital to long-lead procurements and mature the design toward lock.',
    ring: 'ring-blue-300',
    chipBg: 'bg-blue-50',
    chipText: 'text-blue-700',
    dotBg: 'bg-blue-500',
    barGradient: 'from-blue-300 to-blue-600'
  },
  {
    id: 'CDR',
    name: 'Critical Design Review',
    oneLiner: 'Design is fully detailed and baselined — "design lock".',
    description:
      'All drawings, schematics, firmware, and software are complete, reviewed, and released. DFMEA / design analyses are closed. From CDR onward the design is considered locked; further changes flow through formal configuration / change control (ECO / ECN). The team is ready to build qualification hardware.',
    ring: 'ring-indigo-300',
    chipBg: 'bg-indigo-50',
    chipText: 'text-indigo-700',
    dotBg: 'bg-indigo-500',
    barGradient: 'from-indigo-300 to-indigo-600'
  },
  {
    id: 'TRR',
    name: 'Test Readiness Review',
    oneLiner: 'Verification plan, fixtures, and units are ready to test.',
    description:
      'Verification plans, test procedures, fixtures, and instrumentation are complete and reviewed. Units under test are available and configured to the intended baseline. TRR formally authorizes the start of qualification / V&V testing and is the point where test evidence generation begins.',
    ring: 'ring-amber-300',
    chipBg: 'bg-amber-50',
    chipText: 'text-amber-700',
    dotBg: 'bg-amber-500',
    barGradient: 'from-amber-300 to-amber-500'
  },
  {
    id: 'PRR',
    name: 'Production Readiness Review',
    oneLiner: 'Manufacturing is validated at production cadence.',
    description:
      'The production process is validated (PPAP / FAI / equivalent), suppliers are qualified, yield / FPY and unit cost are within targets, and service / logistics / training are in place. PRR is the formal hand-off from engineering to manufacturing — after a successful PRR the program is authorized to ramp.',
    ring: 'ring-rose-300',
    chipBg: 'bg-rose-50',
    chipText: 'text-rose-700',
    dotBg: 'bg-rose-500',
    barGradient: 'from-rose-300 to-rose-600'
  },
  {
    id: 'MP',
    name: 'Mass Production',
    oneLiner: 'Sustained production — focus shifts to yield and field quality.',
    description:
      'Ongoing volume production. Engineering and operations focus on yield improvement, scrap / rework reduction, supplier performance, field quality (RMA, FRU), and lifecycle management (ECO throughput, obsolescence). Gate criteria become steady-state KPIs rather than one-time exit events.',
    ring: 'ring-emerald-300',
    chipBg: 'bg-emerald-50',
    chipText: 'text-emerald-700',
    dotBg: 'bg-emerald-500',
    barGradient: 'from-emerald-300 to-emerald-600'
  }
];

// ---------------------------------------------------------------------------
// Gate Map visual — horizontal SVG flow diagram.
// Nodes are colored discs with the gate abbreviation; a soft connector
// line runs through them. Below the SVG is a responsive grid of description
// cards. The diagram wraps on narrow screens via horizontal overflow.
// ---------------------------------------------------------------------------

const GateMap: React.FC = () => {
  return (
    <div className="space-y-8">
      {/* Lead paragraph */}
      <div>
        <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 mb-2">
          The Stage Gate Map
        </h3>
        <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
          Most hardware and systems programs move through a common sequence of
          formal reviews — each one confirms a specific class of maturity and
          unlocks the next set of activities. BridgeOps tracks the same six
          gates regardless of the industry you're in; the vocabulary below is
          aligned to MIL-STD-1521 / NASA SE handbooks and maps cleanly onto
          IATF 16949, ISO 9001, and most internal stage-gate processes.
        </p>
      </div>

      {/* Horizontal flow diagram */}
      <div className="bg-white border border-slate-200 rounded-sm p-6 overflow-x-auto">
        <div className="min-w-[720px]">
          <svg
            viewBox="0 0 720 150"
            className="w-full h-auto"
            role="img"
            aria-label="Stage gate flow: CR, PDR, CDR, TRR, PRR, MP"
          >
            {/* Connector line */}
            <defs>
              <linearGradient id="gateFlow" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#94a3b8" />
                <stop offset="20%" stopColor="#3b82f6" />
                <stop offset="40%" stopColor="#6366f1" />
                <stop offset="60%" stopColor="#f59e0b" />
                <stop offset="80%" stopColor="#e11d48" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>
            <line
              x1="60"
              y1="70"
              x2="660"
              y2="70"
              stroke="url(#gateFlow)"
              strokeWidth="4"
              strokeLinecap="round"
            />
            {/* Forward arrowhead */}
            <polygon points="660,62 676,70 660,78" fill="#10b981" />

            {GATES.map((g, i) => {
              const cx = 60 + i * 120;
              const fill =
                g.id === 'CR'
                  ? '#64748b'
                  : g.id === 'PDR'
                  ? '#3b82f6'
                  : g.id === 'CDR'
                  ? '#6366f1'
                  : g.id === 'TRR'
                  ? '#f59e0b'
                  : g.id === 'PRR'
                  ? '#e11d48'
                  : '#10b981';
              return (
                <g key={g.id}>
                  {/* Halo */}
                  <circle cx={cx} cy="70" r="26" fill="white" />
                  <circle
                    cx={cx}
                    cy="70"
                    r="22"
                    fill={fill}
                    stroke="white"
                    strokeWidth="3"
                  />
                  {/* Abbreviation */}
                  <text
                    x={cx}
                    y="75"
                    textAnchor="middle"
                    fontFamily="Inter, system-ui, sans-serif"
                    fontWeight="900"
                    fontSize="13"
                    fill="white"
                    letterSpacing="0.5"
                  >
                    {g.id}
                  </text>
                  {/* Name below — wrapped onto two lines so long names like
                      "Production Readiness Review" don't overlap their
                      neighbors in the 120px column. Split on the first
                      space; the rest goes on the second line. */}
                  {(() => {
                    const words = g.name.toUpperCase().split(' ');
                    const line1 = words[0];
                    const line2 = words.slice(1).join(' ');
                    return (
                      <text
                        x={cx}
                        y="112"
                        textAnchor="middle"
                        fontFamily="Inter, system-ui, sans-serif"
                        fontWeight="700"
                        fontSize="9"
                        fill="#334155"
                        letterSpacing="0.8"
                      >
                        <tspan x={cx}>{line1}</tspan>
                        {line2 && (
                          <tspan x={cx} dy="11">
                            {line2}
                          </tspan>
                        )}
                      </text>
                    );
                  })()}
                  {/* Step index above */}
                  <text
                    x={cx}
                    y="32"
                    textAnchor="middle"
                    fontFamily="Inter, system-ui, sans-serif"
                    fontWeight="900"
                    fontSize="9"
                    fill="#94a3b8"
                    letterSpacing="2"
                  >
                    {`STEP ${i + 1}`}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Legend line */}
        <div className="mt-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <Compass size={12} />
          <span>
            Read left to right — each gate confirms the maturity needed to
            start the next phase of work.
          </span>
        </div>
      </div>

      {/* Per-gate description cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {GATES.map((g, i) => (
          <motion.div
            key={g.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.03 }}
            className="bg-white border border-slate-200 rounded-sm p-5"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full ${g.dotBg} text-white text-[10px] font-black tracking-widest`}
                >
                  {g.id}
                </span>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">
                    Step {i + 1}
                  </p>
                  <h4 className="text-sm font-black uppercase tracking-tight text-slate-900 leading-tight">
                    {g.name}
                  </h4>
                </div>
              </div>
              <span
                className={`flex-shrink-0 px-2 py-0.5 rounded-sm text-[9px] font-black uppercase tracking-widest ${g.chipBg} ${g.chipText}`}
              >
                {g.id}
              </span>
            </div>
            <p className="text-[12px] font-semibold text-slate-700 leading-snug mb-2">
              {g.oneLiner}
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {g.description}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Footnote on terminology */}
      <div className="bg-slate-50 border border-slate-200 rounded-sm p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
          A note on terminology
        </p>
        <p className="text-[11px] text-slate-600 leading-relaxed">
          Organizations use different names for the same gates — CDR might be
          called "Design Freeze" in one company and "Final Design Review" in
          another; PRR can appear as "Transfer to Manufacturing" or "Pilot
          Production Gate". BridgeOps uses the names above as a stable anchor
          so projects across industries can be compared side-by-side. Adjust
          your internal documentation to mention both labels if helpful.
        </p>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Subject registry — each subject is a tile in the sidebar plus a content
// renderer. Adding a new academy topic means appending to this list.
// ---------------------------------------------------------------------------

interface Subject {
  id: string;
  title: string;
  subtitle: string;
  icon: React.FC<{ size?: number; className?: string }>;
  render: () => React.ReactNode;
}

const SUBJECTS: Subject[] = [
  {
    id: 'gate-map',
    title: 'Gate Map',
    subtitle: 'The six stage gates, end-to-end',
    icon: MapIcon,
    render: () => <GateMap />
  }
];

// ---------------------------------------------------------------------------
// Main academy shell
// ---------------------------------------------------------------------------

const BridgeOpsAcademy: React.FC = () => {
  const [activeId, setActiveId] = useState<string>(SUBJECTS[0].id);
  const active = SUBJECTS.find((s) => s.id === activeId) || SUBJECTS[0];

  return (
    <div className="space-y-6">
      {/* Header strip */}
      <div className="bg-gradient-to-r from-slate-900 to-blue-950 text-white rounded-sm px-6 py-5 flex items-center gap-3">
        <GraduationCap size={20} className="text-blue-300 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/60 mb-0.5">
            BridgeOps Academy
          </p>
          <h2 className="text-lg font-black uppercase tracking-tight leading-tight">
            Learn the concepts, frameworks, and best-practice behind the tool.
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Subject list */}
        <aside className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mb-3 px-2">
            Subjects
          </p>
          {SUBJECTS.map((s) => {
            const isActive = s.id === activeId;
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                className={`w-full text-left px-3 py-3 rounded-sm transition-all flex items-start gap-3 border ${
                  isActive
                    ? 'bg-blue-50 border-blue-300 shadow-sm'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
                aria-pressed={isActive}
              >
                <Icon
                  size={16}
                  className={
                    isActive ? 'text-blue-600 flex-shrink-0 mt-0.5' : 'text-slate-400 flex-shrink-0 mt-0.5'
                  }
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-[11px] font-black uppercase tracking-widest leading-tight ${
                      isActive ? 'text-blue-700' : 'text-slate-700'
                    }`}
                  >
                    {s.title}
                  </p>
                  <p className="text-[10px] text-slate-500 leading-snug mt-0.5">
                    {s.subtitle}
                  </p>
                </div>
                <ChevronRight
                  size={12}
                  className={
                    isActive ? 'text-blue-400 flex-shrink-0 mt-1' : 'text-slate-300 flex-shrink-0 mt-1'
                  }
                />
              </button>
            );
          })}
          <p className="text-[10px] text-slate-400 italic px-2 pt-3">
            More subjects coming soon.
          </p>
        </aside>

        {/* Active subject */}
        <motion.section
          key={active.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="min-w-0"
        >
          {active.render()}
        </motion.section>
      </div>
    </div>
  );
};

export default BridgeOpsAcademy;
