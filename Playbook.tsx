// ---------------------------------------------------------------------------
// Playbook — "how to use BridgeOps Intelligence" orientation guide.
//
// Lives in the Dashboard tab strip to the right of BridgeOps Academy.
// Matches the Academy's visual language: same dark gradient header,
// same 260px sidebar, same card typography and border styles.
//
// Four sections:
//   1. Start Here    — project setup, gate selection, General Info
//   2. Tool Sequence — the recommended NPI arc and tool groupings
//   3. RAMP Score    — how the readiness score is built
//   4. AI Analysis   — when to run it and what it reads
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen,
  ChevronRight,
  LayoutDashboard,
  Workflow,
  BarChart2,
  Sparkles,
  Plus,
  Flag,
  FileText,
  FlaskConical,
  Users,
  ShieldAlert,
  GitBranch,
  Package,
  Scale,
  Lightbulb,
  ClipboardList,
  Wallet,
  ArrowRight,
  CheckCircle2,
  Brain,
  Search,
  Layers,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Section: Start Here
// ---------------------------------------------------------------------------

const StartHere: React.FC = () => (
  <div className="space-y-8">
    <div>
      <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 mb-2">
        Start Here
      </h3>
      <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
        Every project follows the same three setup steps before you add tool
        data. Taking 60 seconds here makes everything else — scoring, AI
        Analysis, Org Insights — more useful.
      </p>
    </div>

    {/* Three setup steps */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[
        {
          step: '01',
          title: 'Create the project',
          body: 'Click "+ New Project" on the Dashboard. Give it a name, pick a product type, and assign a template (Full Ramp for the complete gate + deliverable set; lighter templates for focused work).',
          icon: Plus,
          color: 'blue',
        },
        {
          step: '02',
          title: 'Set the current gate',
          body: 'Open the project → General Info tab → "Current Gate" dropdown. This is the single most important field — the AI, deliverable highlighting, and RAMP gating all read from it.',
          icon: Flag,
          color: 'indigo',
        },
        {
          step: '03',
          title: 'Fill General Info',
          body: 'Add project notes, team & roles, and link any connected projects (programs that share suppliers or sub-assemblies). The AI Analysis reads all of these on every scan.',
          icon: FileText,
          color: 'slate',
        },
      ].map(({ step, title, body, icon: Icon, color }) => (
        <div
          key={step}
          className="bg-white border border-slate-200 rounded-sm p-5"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <span
              className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-[10px] font-black tracking-widest flex-shrink-0 ${
                color === 'blue'
                  ? 'bg-blue-500'
                  : color === 'indigo'
                  ? 'bg-indigo-500'
                  : 'bg-slate-500'
              }`}
            >
              {step}
            </span>
            <Icon
              size={16}
              className={`flex-shrink-0 mt-0.5 ${
                color === 'blue'
                  ? 'text-blue-400'
                  : color === 'indigo'
                  ? 'text-indigo-400'
                  : 'text-slate-400'
              }`}
            />
          </div>
          <h4 className="text-sm font-black uppercase tracking-tight text-slate-900 mb-1">
            {title}
          </h4>
          <p className="text-[11px] text-slate-500 leading-relaxed">{body}</p>
        </div>
      ))}
    </div>

    {/* Deliverable checklist note */}
    <div className="bg-blue-50 border border-blue-200 rounded-sm p-5">
      <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-1">
        Deliverables &amp; RAMP scores
      </p>
      <p className="text-[11px] text-slate-700 leading-relaxed">
        The four score tabs (Product &amp; Design · Manufacturing · Supply Chain
        · Process &amp; Quality) each contain metric rows with pre-built
        deliverable checklists. Check off items as they're done — the RAMP
        percentage updates live. Add custom deliverables to any row for
        project-specific items. Use the notes field on each row to capture
        context (ECO numbers, decisions, in-flight status) — the project search
        indexes these notes too.
      </p>
    </div>

    {/* Search tip */}
    <div className="bg-white border border-slate-200 rounded-sm p-4 flex items-start gap-3">
      <Search size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
      <p className="text-[11px] text-slate-600 leading-relaxed">
        <span className="font-black text-slate-800">Project Search</span>{' '}
        (footer "Search" button inside any open project) scans across all tool
        records, metric notes, and deliverable labels — so a part number or ECO
        reference typed once in any field is always findable.
      </p>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Section: Tool Sequence
// ---------------------------------------------------------------------------

interface ToolCard {
  label: string;
  icon: React.FC<{ size?: number; className?: string }>;
  color: string;
  when: string;
  what: string;
}

const QUALITY_TRIAD: ToolCard[] = [
  {
    label: 'Process Map',
    icon: GitBranch,
    color: 'text-blue-600',
    when: 'As soon as the process steps are known (PDR→CDR)',
    what: 'Document the manufacturing workflow — each step, decision, and flow. The Process Map feeds the PFMEA and Control Plan.',
  },
  {
    label: 'PFMEA',
    icon: ShieldAlert,
    color: 'text-rose-600',
    when: 'After the Process Map is drafted (CDR)',
    what: 'Score each failure mode using AIAG-VDA 2019 anchors. High-RPN risks flow into AI Analysis as first-class signals.',
  },
  {
    label: 'Control Plan',
    icon: ClipboardList,
    color: 'text-orange-600',
    when: 'After PFMEA (CDR→TRR)',
    what: 'Define the control methods, sample plans, and reaction plans for every product and process characteristic — especially critical/significant ones.',
  },
];

const GOVERNANCE_TOOLS: ToolCard[] = [
  {
    label: 'Decision Ledger',
    icon: Scale,
    color: 'text-indigo-600',
    when: 'Throughout the program (any gate)',
    what: 'Log every significant decision with its rationale, risks, and impact. Reversed decisions surface as instability signals in AI Analysis.',
  },
  {
    label: 'Meetings',
    icon: Users,
    color: 'text-violet-600',
    when: 'Throughout the program (any gate)',
    what: 'Log meeting notes and action items. Action items that reference part numbers or decisions become findable via Project Search.',
  },
];

const TRACKING_TOOLS: ToolCard[] = [
  {
    label: 'ECO Pulse',
    icon: Package,
    color: 'text-amber-600',
    when: 'On every BOM revision (CDR onward)',
    what: 'Upload BOM revisions or log ECO events. The diff is automatic; AI Impact assesses how the change affects readiness.',
  },
  {
    label: 'Takt Studies',
    icon: FlaskConical,
    color: 'text-emerald-600',
    when: 'During pilot production (TRR→PRR)',
    what: 'Capture time observations per step. The capacity verdict (Green / Amber / Red) appears as a header pill and feeds AI Analysis.',
  },
  {
    label: 'Budget Tracker',
    icon: Wallet,
    color: 'text-green-600',
    when: 'Set kickoff estimate early; log actuals as they land',
    what: 'Plan by category + log actual spend. Budget variance flags in AI Analysis when >10% over plan near a gate.',
  },
];

const CAPTURE_TOOLS: ToolCard[] = [
  {
    label: 'Lessons & Learned',
    icon: Lightbulb,
    color: 'text-teal-600',
    when: 'After incidents, escapes, or design changes',
    what: "Capture root causes and MUST actions. Open MUST actions surface in AI Analysis so they don't slip through gate reviews.",
  },
];

const ToolRow: React.FC<{ tools: ToolCard[] }> = ({ tools }) => (
  <div className="grid grid-cols-1 gap-3">
    {tools.map(({ label, icon: Icon, color, when, what }) => (
      <div key={label} className="bg-white border border-slate-200 rounded-sm p-4 flex items-start gap-4">
        <Icon size={16} className={`${color} flex-shrink-0 mt-0.5`} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-800 mb-0.5">
            {label}
          </p>
          <p className="text-[11px] text-slate-500 leading-snug">
            <span className="font-semibold text-slate-600">When: </span>{when}
          </p>
          <p className="text-[11px] text-slate-500 leading-snug mt-0.5">{what}</p>
        </div>
      </div>
    ))}
  </div>
);

const ToolSequence: React.FC = () => (
  <div className="space-y-8">
    <div>
      <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 mb-2">
        Tool Sequence
      </h3>
      <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
        The tools aren't independent — they form a connected data model. This
        is the recommended order for a typical NPI program. Tools in the same
        group can run in parallel; groups are roughly sequential.
      </p>
    </div>

    {/* Quality Backbone */}
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
          Group 1 — Quality backbone
        </span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>
      <p className="text-[11px] text-slate-500 italic mb-3">
        The classic triad: Process Map seeds the PFMEA; the PFMEA seeds the
        Control Plan. Run them in order for maximum cross-tool value.
      </p>
      {/* Arrow flow */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {['Process Map', 'PFMEA', 'Control Plan'].map((t, i) => (
          <React.Fragment key={t}>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 text-white rounded-sm text-[10px] font-black uppercase tracking-widest">
              {t}
            </span>
            {i < 2 && <ArrowRight size={12} className="text-slate-400 flex-shrink-0" />}
          </React.Fragment>
        ))}
        <span className="ml-2 text-[10px] text-slate-400 italic">
          steps import between tools
        </span>
      </div>
      <ToolRow tools={QUALITY_TRIAD} />
    </div>

    {/* Governance */}
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
          Group 2 — Governance &amp; communication
        </span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>
      <ToolRow tools={GOVERNANCE_TOOLS} />
    </div>

    {/* Tracking */}
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
          Group 3 — Change &amp; cost tracking
        </span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>
      <ToolRow tools={TRACKING_TOOLS} />
    </div>

    {/* Capture */}
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
          Group 4 — Continuous capture
        </span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>
      <ToolRow tools={CAPTURE_TOOLS} />
    </div>

    {/* Note on Project Tools launcher */}
    <div className="bg-slate-50 border border-slate-200 rounded-sm p-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
        Where to find the tools
      </p>
      <p className="text-[11px] text-slate-600 leading-relaxed">
        All tools live behind the{' '}
        <span className="font-black text-slate-800">Project Tools</span> button
        in the secondary tab strip inside each project. The primary tabs
        (General Info · Product &amp; Design · Manufacturing · Supply Chain ·
        Process &amp; Quality) are for scoring; the secondary strip (AI
        Analysis · Project Tools · History · Activity) is where you work.
      </p>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Section: RAMP Score
// ---------------------------------------------------------------------------

const RampScore: React.FC = () => (
  <div className="space-y-8">
    <div>
      <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 mb-2">
        RAMP Score
      </h3>
      <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
        The RAMP score is the single readiness number for a project — a
        weighted average across four groups. It's not a vanity metric; it's
        built from deliverable completion and manual scores that you control.
      </p>
    </div>

    {/* Four groups */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[
        {
          id: 'PD',
          label: 'Product & Design',
          color: 'bg-blue-500',
          chipBg: 'bg-blue-50',
          chipText: 'text-blue-700',
          desc: 'Design freeze, BOM stability, testability, configuration control. Anchored around CDR — if the design isn\'t locked here, every downstream metric suffers.',
        },
        {
          id: 'MFG',
          label: 'Manufacturing',
          color: 'bg-indigo-500',
          chipBg: 'bg-indigo-50',
          chipText: 'text-indigo-700',
          desc: 'Process maturity, takt capacity, yield, tooling, and operator qualification. The Takt Study capacity verdict connects directly to this group.',
        },
        {
          id: 'SC',
          label: 'Supply Chain',
          color: 'bg-amber-500',
          chipBg: 'bg-amber-50',
          chipText: 'text-amber-700',
          desc: 'Supplier qualification, lead times, single-source risk, logistics readiness. Alt BOM and Supplier Tracker data surface here.',
        },
        {
          id: 'PQ',
          label: 'Process & Quality',
          color: 'bg-emerald-500',
          chipBg: 'bg-emerald-50',
          chipText: 'text-emerald-700',
          desc: 'PFMEA completion, control plan, FPY, warranty preparedness, regulatory compliance. The PFMEA and Control Plan tools feed this group directly.',
        },
      ].map((g) => (
        <div key={g.id} className="bg-white border border-slate-200 rounded-sm p-5">
          <div className="flex items-start justify-between gap-3 mb-2">
            <span
              className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-[10px] font-black tracking-widest flex-shrink-0 ${g.color}`}
            >
              {g.id}
            </span>
            <span
              className={`px-2 py-0.5 rounded-sm text-[9px] font-black uppercase tracking-widest ${g.chipBg} ${g.chipText}`}
            >
              {g.label}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">{g.desc}</p>
        </div>
      ))}
    </div>

    {/* How scoring works */}
    <div className="bg-white border border-slate-200 rounded-sm p-5 space-y-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
        How the score is calculated
      </p>
      {[
        {
          icon: CheckCircle2,
          color: 'text-emerald-500',
          text: 'Bar-kind metrics (most metrics) derive their % from deliverable completion — check off items, the bar moves automatically.',
        },
        {
          icon: BarChart2,
          color: 'text-blue-500',
          text: 'Value-kind metrics (MTBF, FPY, scrap rate) blend a manual numeric score 50/50 with deliverable completion when deliverables are attached.',
        },
        {
          icon: Layers,
          color: 'text-slate-500',
          text: 'Each group score is a weighted average of its items. The overall RAMP score is a weighted average of the four groups. Weights are tuned to reflect industry norms for NPI risk.',
        },
      ].map(({ icon: Icon, color, text }, i) => (
        <div key={i} className="flex items-start gap-3">
          <Icon size={14} className={`${color} flex-shrink-0 mt-0.5`} />
          <p className="text-[11px] text-slate-600 leading-relaxed">{text}</p>
        </div>
      ))}
    </div>

    {/* Thresholds */}
    <div className="grid grid-cols-3 gap-3">
      {[
        { label: 'Critical', range: '0 – 39 %', bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', dot: 'bg-rose-500', desc: 'Significant gaps — project is not ready to advance.' },
        { label: 'At Risk', range: '40 – 69 %', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500', desc: 'Progress visible but material items open.' },
        { label: 'On Track', range: '70 – 100 %', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500', desc: 'Ready — remaining items are minor or in-progress.' },
      ].map((t) => (
        <div key={t.label} className={`${t.bg} border ${t.border} rounded-sm p-4`}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`w-2 h-2 rounded-full ${t.dot}`} />
            <span className={`text-[10px] font-black uppercase tracking-widest ${t.text}`}>{t.label}</span>
          </div>
          <p className={`text-lg font-black ${t.text} mb-1`}>{t.range}</p>
          <p className="text-[10px] text-slate-600 leading-snug">{t.desc}</p>
        </div>
      ))}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Section: AI Analysis
// ---------------------------------------------------------------------------

const AIAnalysis: React.FC = () => (
  <div className="space-y-8">
    <div>
      <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 mb-2">
        AI Analysis
      </h3>
      <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
        The AI Analysis tab runs a full project scan using Gemini. It reads
        every live data source in the project and returns a status snapshot,
        prioritized risks, and top actions — all gate-aware.
      </p>
    </div>

    {/* What it reads */}
    <div className="bg-white border border-slate-200 rounded-sm p-5">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">
        What the AI reads on every scan
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { icon: BarChart2, color: 'text-blue-500', label: 'RAMP scores', desc: 'Current group scores, overall %, enabled metric titles' },
          { icon: ShieldAlert, color: 'text-rose-500', label: 'PFMEA risks', desc: 'Top risks by RPN, High/Medium/Low tier counts' },
          { icon: Package, color: 'text-amber-500', label: 'ECO Pulse', desc: 'Latest BOM diff, reason for change, supplier swap count' },
          { icon: Scale, color: 'text-indigo-500', label: 'Decision Ledger', desc: 'Active decisions and any reversed decisions (instability signal)' },
          { icon: Users, color: 'text-violet-500', label: 'Meetings', desc: 'Recent action items, internal vs. external type' },
          { icon: FlaskConical, color: 'text-emerald-500', label: 'Takt Studies', desc: 'Capacity verdict (Green / Amber / Red), bottleneck, headroom %' },
          { icon: Lightbulb, color: 'text-teal-500', label: 'Lessons & Learned', desc: 'Open MUST actions, recurring root causes' },
          { icon: ClipboardList, color: 'text-orange-500', label: 'Control Plan', desc: 'Critical/significant characteristic counts, plan type vs. gate' },
          { icon: GitBranch, color: 'text-blue-400', label: 'Process Map', desc: 'Step count, decision points, process completeness signal' },
          { icon: Wallet, color: 'text-green-500', label: 'Budget Tracker', desc: 'Estimate vs. actual, per-category variance' },
        ].map(({ icon: Icon, color, label, desc }) => (
          <div key={label} className="flex items-start gap-3">
            <Icon size={13} className={`${color} flex-shrink-0 mt-0.5`} />
            <div>
              <p className="text-[11px] font-black text-slate-700">{label}</p>
              <p className="text-[10px] text-slate-500">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* Output */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[
        {
          label: 'Status Snapshot',
          color: 'border-slate-300 bg-slate-50',
          textColor: 'text-slate-700',
          desc: 'A single sentence verdict for the project right now — ≤25 words. Useful in status updates and gate review prep.',
        },
        {
          label: 'Top Risks',
          color: 'border-rose-200 bg-rose-50',
          textColor: 'text-rose-700',
          desc: 'Up to 8 risks, each with a source attribution (PFMEA · Decisions · ECO Pulse · SOP Drift · Cross-project). Sorted by severity × gate proximity.',
        },
        {
          label: 'Top Actions',
          color: 'border-blue-200 bg-blue-50',
          textColor: 'text-blue-700',
          desc: 'Up to 5 concrete actions — who owns it, by when, linked to the specific gap. Gated: actions due before the next gate appear first.',
        },
      ].map((o) => (
        <div key={o.label} className={`border ${o.color} rounded-sm p-4`}>
          <p className={`text-[10px] font-black uppercase tracking-widest ${o.textColor} mb-2`}>{o.label}</p>
          <p className="text-[11px] text-slate-600 leading-relaxed">{o.desc}</p>
        </div>
      ))}
    </div>

    {/* When to run */}
    <div className="bg-white border border-slate-200 rounded-sm p-5 space-y-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
        When to run it
      </p>
      {[
        'After adding significant tool data — a new PFMEA, a BOM revision, a batch of decisions.',
        'Before any gate review — the status snapshot is ready-to-paste into a pre-read.',
        'After a program event (supplier change, ECO, test failure) to see the propagated risk.',
        'Weekly for active programs approaching a gate.',
      ].map((t, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="w-4 h-4 rounded-full bg-blue-500 text-white text-[9px] font-black flex items-center justify-center flex-shrink-0 mt-0.5">
            {i + 1}
          </span>
          <p className="text-[11px] text-slate-600 leading-relaxed">{t}</p>
        </div>
      ))}
    </div>

    {/* Org Insights note */}
    <div className="bg-gradient-to-r from-slate-900 to-blue-950 text-white rounded-sm p-5">
      <div className="flex items-start gap-3">
        <Brain size={16} className="text-blue-300 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/60 mb-1">
            Org Insights — after 3+ projects
          </p>
          <p className="text-[12px] text-white/80 leading-relaxed">
            Every time you run AI Analysis, the result is saved to a project
            intelligence store. Once 3+ projects have been analyzed, the{' '}
            <span className="text-white font-black">Org Insights</span> button
            on the Dashboard becomes meaningful — it surfaces cross-project
            patterns: recurring root causes, shared supplier exposure, programs
            consistently slipping the same gate. This is the institutional
            memory layer that gets better with every project.
          </p>
        </div>
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Section registry
// ---------------------------------------------------------------------------

interface Section {
  id: string;
  title: string;
  subtitle: string;
  icon: React.FC<{ size?: number; className?: string }>;
  render: () => React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'start-here',
    title: 'Start Here',
    subtitle: 'Project setup in three steps',
    icon: LayoutDashboard,
    render: () => <StartHere />,
  },
  {
    id: 'tool-sequence',
    title: 'Tool Sequence',
    subtitle: 'Recommended NPI arc — four groups',
    icon: Workflow,
    render: () => <ToolSequence />,
  },
  {
    id: 'ramp-score',
    title: 'RAMP Score',
    subtitle: 'How the readiness score is built',
    icon: BarChart2,
    render: () => <RampScore />,
  },
  {
    id: 'ai-analysis',
    title: 'AI Analysis',
    subtitle: 'Full project scan — what it reads',
    icon: Sparkles,
    render: () => <AIAnalysis />,
  },
];

// ---------------------------------------------------------------------------
// Main shell — mirrors Academy's two-column layout
// ---------------------------------------------------------------------------

const Playbook: React.FC = () => {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);
  const active = SECTIONS.find((s) => s.id === activeId) || SECTIONS[0];

  return (
    <div className="space-y-6">
      {/* Header — same gradient as Academy */}
      <div className="bg-gradient-to-r from-slate-900 to-blue-950 text-white rounded-sm px-6 py-5 flex items-center gap-3">
        <BookOpen size={20} className="text-blue-300 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/60 mb-0.5">
            Playbook
          </p>
          <h2 className="text-lg font-black uppercase tracking-tight leading-tight">
            How to get the most out of BridgeOps Intelligence.
          </h2>
        </div>
      </div>

      {/* Two-column layout — same grid as Academy */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Section list */}
        <aside className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mb-3 px-2">
            Sections
          </p>
          {SECTIONS.map((s) => {
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
                    isActive
                      ? 'text-blue-600 flex-shrink-0 mt-0.5'
                      : 'text-slate-400 flex-shrink-0 mt-0.5'
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
                    isActive
                      ? 'text-blue-400 flex-shrink-0 mt-1'
                      : 'text-slate-300 flex-shrink-0 mt-1'
                  }
                />
              </button>
            );
          })}
        </aside>

        {/* Active section */}
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

export default Playbook;
