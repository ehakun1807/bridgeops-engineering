
import React from 'react';
import { ArrowRight, Database, BarChart3, Brain, ShieldCheck, X, Check, TrendingUp } from 'lucide-react';
import type { NavigateFn } from './types';

interface IntelligencePageProps {
  onNavigate: NavigateFn;
  onRequestAccess: () => void;
}

const PILLARS = [
  {
    icon: Database,
    eyebrow: 'Pillar 01',
    title: 'Structured capture across the full NPI lifecycle',
    body: 'Every engineering discipline has a purpose-built workspace. PFMEA, BOM revisions, takt studies, decision records, process maps, meetings, document audits — data is structured from first entry, not reverse-engineered from spreadsheets at gate review.',
    tools: ['PFMEA', 'ECO Pulse', 'Takt Studies', 'Decision Ledger', 'Process Map', 'Doc Guard', 'SOP Radar'],
  },
  {
    icon: BarChart3,
    eyebrow: 'Pillar 02',
    title: 'Gate-aware readiness scoring — the RAMP framework',
    body: 'A proprietary readiness framework scores your program continuously across manufacturing, quality, supply chain, and engineering dimensions — relative to your current gate. Not a status color. A real number that moves when your data moves.',
    tools: ['CR → PDR → CDR → PRR → MP', 'Live RAMP %', 'Deliverable tracking'],
  },
  {
    icon: Brain,
    eyebrow: 'Pillar 03',
    title: 'AI that connects signals across tools',
    body: "The AI doesn't analyze each tool in isolation. It reads all of them together — detecting when a BOM supplier swap puts a high-RPN PFMEA risk in play, when a downstream change contradicts an earlier engineering decision, or when takt capacity is incompatible with the gate's demand target.",
    tools: ['Cross-tool scan', 'Decision drift detection', 'Risk pattern recognition'],
  },
  {
    icon: ShieldCheck,
    eyebrow: 'Pillar 04',
    title: 'Proactive risk interception — not post-mortems',
    body: 'A live activity feed logs every engineering event as it happens. High-signal events trigger automatic cross-checks. Risks surface weeks before a gate review — not during it. The platform watches your program so you stay ahead of it.',
    tools: ['Live activity feed', 'High-signal alerts', 'Audit trail'],
  },
];

const REPLACES = [
  'Spreadsheet-based PFMEA & BOM trackers',
  'Generic project management tools not built for NPI',
  'Scattered BOM revision history across file shares',
  'Engineering decisions buried in email threads',
  'Manual gate-readiness decks assembled at review time',
];

const ALONGSIDE = [
  'PLM systems (Arena, Agile, Windchill)',
  'ERP platforms',
  'CAD & simulation tools',
  'QMS / eQMS platforms',
];

const IntelligencePage: React.FC<IntelligencePageProps> = ({ onNavigate, onRequestAccess }) => {
  return (
    <div className="min-h-screen text-left">

      {/* ── Hero ── */}
      <section className="bg-slate-950 pt-10 pb-28 relative overflow-hidden">
        <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-600/5 rounded-full blur-3xl"></div>
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl">
            <span className="text-blue-500 font-black uppercase tracking-[0.4em] text-[10px] mb-8 block">
              BridgeOps Intelligence · Operational AI Platform
            </span>
            <h1 className="text-5xl md:text-7xl font-black text-white tracking-tighter uppercase leading-[0.85] mb-8">
              The Operating System<br />
              <span className="text-blue-500">Your NPI Program</span><br />
              Never Had.
            </h1>
            <p className="text-slate-400 text-lg font-medium max-w-2xl leading-relaxed mb-12">
              From concept release to mass production, hardware teams track risks in PFMEA
              spreadsheets, BOM changes in email, and decisions in Slack threads — with nothing
              connecting any of it. BridgeOps Intelligence changes that.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={onRequestAccess}
                aria-label="Request early access to BridgeOps Intelligence"
                className="bg-blue-600 hover:bg-blue-700 text-white px-10 py-5 font-black uppercase tracking-[0.2em] text-xs transition-all shadow-2xl shadow-blue-500/20 flex items-center group w-fit"
              >
                Request Access
                <ArrowRight size={16} className="ml-4 group-hover:translate-x-1 transition-transform" />
              </button>
              <button
                onClick={() => onNavigate('ramp_score')}
                aria-label="Try the free Ramp Readiness Snapshot"
                className="bg-white/5 border border-white/10 text-white px-10 py-5 font-black uppercase tracking-[0.2em] text-xs hover:bg-white/10 transition-all flex items-center group w-fit"
              >
                Free Ramp Snapshot
                <ArrowRight size={16} className="ml-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── The Gap ── */}
      <section className="bg-white py-20 border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 mb-6">
            <div className="w-10 h-[1px] bg-blue-600"></div>
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">The Problem</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase leading-tight mb-6">
                No tool exists for<br />
                <span className="text-blue-600">transfer to production.</span>
              </h2>
              <p className="text-slate-500 text-base font-medium leading-relaxed">
                PLM manages your CAD. ERP manages your orders. But the critical gap — the engineering
                intelligence layer that monitors readiness, connects risks across disciplines, and
                flags what's about to go wrong during NPI — has never had a dedicated platform.
                Until now.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { stat: '#1', label: 'Root cause of ramp slip — risks visible in silos, invisible as a connected system' },
                { stat: 'Post-CDR', label: 'When most teams discover what should have been caught at PDR — after the cost multiplied' },
                { stat: 'Built for NPI', label: 'The only operational intelligence platform purpose-built for hardware transfer to production' },
                { stat: 'CR→MP', label: 'Full gate coverage from concept release to mass production' },
              ].map((item) => (
                <div key={item.stat} className="bg-slate-900 p-6 relative overflow-hidden">
                  <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
                  <div className="relative z-10">
                    <div className="text-3xl font-black text-blue-500 tracking-tighter mb-2">{item.stat}</div>
                    <p className="text-slate-400 text-[11px] font-medium leading-relaxed uppercase tracking-wider">{item.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 4 Pillars ── */}
      <section className="bg-slate-50 py-24 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 mb-4">
            <div className="w-10 h-[1px] bg-blue-600"></div>
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">Platform Capabilities</span>
          </div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase mb-16">
            Four Pillars. One Platform.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-200 border border-slate-200 shadow-2xl">
            {PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <div key={pillar.eyebrow} className="bg-white p-10 relative overflow-hidden group hover:bg-slate-950 transition-colors duration-300">
                  <div className="absolute inset-0 blueprint-grid-dark opacity-0 group-hover:opacity-10 transition-opacity duration-300"></div>
                  <div className="relative z-10">
                    <div className="flex items-center space-x-3 mb-6">
                      <div className="w-10 h-10 bg-blue-600 flex items-center justify-center flex-shrink-0">
                        <Icon size={18} className="text-white" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-600 group-hover:text-blue-400 transition-colors">
                        {pillar.eyebrow}
                      </span>
                    </div>
                    <h3 className="text-xl font-black text-slate-900 group-hover:text-white tracking-tight uppercase leading-snug mb-4 transition-colors">
                      {pillar.title}
                    </h3>
                    <p className="text-slate-500 group-hover:text-slate-400 text-sm font-medium leading-relaxed mb-6 transition-colors">
                      {pillar.body}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {pillar.tools.map((tool) => (
                        <span
                          key={tool}
                          className="text-[9px] font-black uppercase tracking-widest bg-slate-100 group-hover:bg-white/10 text-slate-600 group-hover:text-slate-300 px-2.5 py-1 transition-colors"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Institutional Memory ── */}
      <section className="bg-white py-24 border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 mb-4">
            <div className="w-10 h-[1px] bg-blue-600"></div>
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">Org Learning</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <div>
              <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase leading-tight mb-6">
                What happens after<br />
                <span className="text-blue-600">your first three projects.</span>
              </h2>
              <p className="text-slate-500 text-base font-medium leading-relaxed mb-6">
                Most tools reset when a project closes. The lessons stay in someone's head,
                the risks disappear from the dashboard, and the next team starts from zero.
              </p>
              <p className="text-slate-500 text-base font-medium leading-relaxed mb-6">
                BridgeOps Intelligence is different. Every AI Analysis run is persisted —
                not discarded. As projects accumulate, the platform starts asking questions
                no single-project tool can ask: Which risks keep showing up regardless of
                team or product type? Which gate consistently breaks down? Which supplier
                relationship keeps generating late-stage changes?
              </p>
              <p className="text-slate-900 text-base font-black leading-relaxed uppercase tracking-wide">
                That's institutional memory as a feature —<br />not a byproduct.
              </p>
            </div>

            <div className="space-y-px border border-slate-200 shadow-sm">
              {[
                {
                  stage: 'After project 1',
                  color: 'bg-slate-100',
                  labelColor: 'text-slate-500',
                  title: 'Single-project intelligence',
                  body: 'AI reads PFMEA, BOM, decisions, and takt together. Risks are surfaced in context, not in isolation. You get a full-program scan in seconds instead of a gate-review deck assembled the night before.',
                },
                {
                  stage: 'After project 3',
                  color: 'bg-blue-50',
                  labelColor: 'text-blue-600',
                  title: 'Patterns begin to emerge',
                  body: 'The platform cross-references your completed programs and flags what they have in common — recurring risk categories, gates where readiness consistently lags, supplier relationships that keep generating late changes. The org starts learning.',
                },
                {
                  stage: 'After project 5+',
                  color: 'bg-slate-900',
                  labelColor: 'text-blue-400',
                  title: 'Compounding organizational advantage',
                  body: 'New projects benefit from everything that came before. Risks that would take weeks to surface get flagged in the first review. Process gaps that burned you twice don\'t get a third chance. The platform turns program history into a competitive edge.',
                  dark: true,
                },
              ].map((item) => (
                <div key={item.stage} className={`p-8 ${item.color}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <TrendingUp size={14} className={item.dark ? 'text-blue-400' : 'text-blue-600'} />
                    <span className={`text-[9px] font-black uppercase tracking-[0.3em] ${item.labelColor}`}>
                      {item.stage}
                    </span>
                  </div>
                  <h3 className={`text-base font-black uppercase tracking-tight mb-2 ${item.dark ? 'text-white' : 'text-slate-900'}`}>
                    {item.title}
                  </h3>
                  <p className={`text-sm font-medium leading-relaxed ${item.dark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Replaces vs Alongside ── */}
      <section className="bg-slate-900 py-24 relative overflow-hidden">
        <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 mb-4">
            <div className="w-10 h-[1px] bg-blue-600"></div>
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-500">Positioning</span>
          </div>
          <h2 className="text-4xl font-black text-white tracking-tighter uppercase mb-16">
            Where It Fits In Your Stack.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="border border-white/10 p-10">
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-red-400 mb-6">Replaces</h3>
              <div className="space-y-4">
                {REPLACES.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <X size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <span className="text-slate-300 text-sm font-medium">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-white/10 p-10">
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400 mb-6">Sits Alongside</h3>
              <div className="space-y-4">
                {ALONGSIDE.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <Check size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span className="text-slate-300 text-sm font-medium">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Request Access CTA ── */}
      <section className="bg-white py-24 border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-slate-900 p-12 md:p-20 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-12">
            <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
            <div className="relative z-10 max-w-xl">
              <span className="text-blue-500 font-black uppercase tracking-[0.4em] text-[10px] mb-4 block">
                Early Access · Closed Beta
              </span>
              <h2 className="text-3xl md:text-5xl font-black text-white uppercase tracking-tighter leading-none mb-6">
                Ready to See It <br />
                <span className="text-blue-500">In Your Program?</span>
              </h2>
              <p className="text-slate-400 text-base font-medium leading-relaxed">
                BridgeOps Intelligence is currently in closed beta with a small group of hardware
                teams. Request access and we'll reach out to schedule a walkthrough tailored to
                your NPI stage.
              </p>
            </div>
            <div className="relative z-10 flex flex-col gap-4 w-full md:w-auto">
              <button
                onClick={onRequestAccess}
                aria-label="Request access to BridgeOps Intelligence"
                className="bg-blue-600 hover:bg-blue-700 text-white px-12 py-5 font-black uppercase tracking-[0.2em] text-xs transition-all shadow-2xl shadow-blue-500/20 flex items-center justify-center group"
              >
                Request Access
                <ArrowRight size={16} className="ml-4 group-hover:translate-x-1 transition-transform" />
              </button>
              <button
                onClick={() => onNavigate('ramp_score')}
                aria-label="Try the free Ramp Readiness Snapshot first"
                className="bg-white/5 border border-white/10 text-slate-400 px-12 py-5 font-black uppercase tracking-[0.2em] text-xs hover:bg-white/10 hover:text-white transition-all flex items-center justify-center group"
              >
                Try Free Ramp Snapshot First
              </button>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};

export default IntelligencePage;
