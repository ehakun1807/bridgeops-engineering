
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
    title: 'Every decision, every team. In one place.',
    body: 'Nothing falls through the cracks.',
    tools: ['PFMEA', 'ECO Pulse', 'Takt Studies', 'Decision Ledger', 'Process Map', 'Doc Guard', 'SOP Radar'],
  },
  {
    icon: BarChart3,
    eyebrow: 'Pillar 02',
    title: 'Always know if you\'re ready to launch.',
    body: 'Live readiness score. No spreadsheet required.',
    tools: ['CR → PDR → CDR → PRR → MP', 'Live RAMP %', 'Deliverable tracking'],
  },
  {
    icon: Brain,
    eyebrow: 'Pillar 03',
    title: 'Nothing gets missed between teams.',
    body: 'Your AI reads every tool together — not one at a time.',
    tools: ['Cross-tool scan', 'Decision drift detection', 'Risk pattern recognition'],
  },
  {
    icon: ShieldCheck,
    eyebrow: 'Pillar 04',
    title: 'Problems caught before they cost you.',
    body: 'Risks surface weeks before your gate review — not during it.',
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
              BridgeOps Intelligence · Built In-House · Ships With Every Engagement
            </span>
            <h1 className="text-5xl md:text-7xl font-black text-white tracking-tighter uppercase leading-[0.85] mb-8">
              The Operating System<br />
              <span className="text-blue-500">Your NPI Program</span><br />
              Never Had.
            </h1>
            <p className="text-slate-400 text-lg font-medium max-w-2xl leading-relaxed mb-12">
              From concept release to mass production, hardware teams track risks in PFMEA
              spreadsheets, BOM changes in email, and decisions in Slack threads — with nothing
              connecting any of it. I built BridgeOps Intelligence to fix that — and it runs
              inside every engagement I deliver.
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
                PLM has your CAD. ERP has your orders.<br />
                Nobody has your transfer.<br />
                <span className="text-blue-600 font-black">Until now.</span>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { stat: '#1', label: 'The hidden cost of disconnected teams.' },
                { stat: 'Post-CDR', label: 'Too late is when most teams find out.' },
                { stat: 'Built for NPI', label: '20+ years of hardware transfers. Built for this, not adapted.' },
                { stat: 'CR→MP', label: 'Every gate. Start to production.' },
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

      {/* ── Bridget ── */}
      <section className="bg-slate-950 py-20 border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Bridget avatar */}
          <div className="flex justify-center mb-8">
            <div className="relative">
              <div className="w-28 h-28 rounded-full flex items-center justify-center shadow-2xl shadow-blue-600/50" style={{background: 'radial-gradient(circle at 38% 30%, #93C5FD, #1E40AF 55%, #1e3a8a 100%)'}}>
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                  <defs>
                    <clipPath id="bridgetCircle">
                      <circle cx="40" cy="40" r="40"/>
                    </clipPath>
                  </defs>
                  {/* BridgeOps logo mark — prominent, fills upper two-thirds */}
                  <g clipPath="url(#bridgetCircle)" transform="translate(5, 0) scale(0.302)" opacity="1">
                    <path fill="white" d="M111.66,132.91c-9.32-1.76-17.89-1.46-25.47-1.2-2.24.08-4.37.15-6.41.16l-.77.02c-9.32.38-18.33-4.52-22.44-12.15l-.04-.07c-2.56-4.7-3.19-11.15-1.77-18.17l.06-.3c2.43-12.84,10.06-24.8,21.49-33.66,11.54-8.95,25.47-13.76,39.27-13.54h.3c20.61.07,39.3,9.72,51.28,26.49,12.12,16.97,15.21,38.07,8.47,57.91l-.12.35c-1.91,5.92-4.44,10.7-7.7,14.61l4.77,6.84c.21-.22.42-.44.62-.67,4.34-4.9,7.62-10.89,10.01-18.27l.1-.29c7.58-22.31,4.1-46.07-9.55-65.19-13.51-18.92-34.59-29.81-57.82-29.88h-.25c-15.59-.23-31.35,5.17-44.34,15.24-12.99,10.07-21.69,23.76-24.48,38.53l-.05.26c-1.79,8.86-.87,17.25,2.6,23.62l.03.06c5.53,10.26,17.53,16.84,29.84,16.39h.61c2.1-.03,4.28-.1,6.6-.18,7.14-.25,15.24-.53,23.67,1.06,18.65,3.51,35.89,14.87,47.29,31.15l21.78,31.25c2.56,3.67,7.61,4.57,11.27,2.01h0s-26.41-37.9-26.41-37.9c-12.6-18.01-31.71-30.57-52.43-34.47Z"/>
                    <path fill="white" d="M231.65,99.12c-2.86-17.89-9.96-35.18-20.55-50.01-10.52-14.73-24.45-26.98-40.28-35.43C153.96,4.69,135.58.09,116.23.01c-25.95-.36-51.87,8.48-72.99,24.86C21.42,41.78,6.7,65.27,1.81,90.99c-3.93,19.62-1.41,38.45,7.27,54.44,6.58,12.18,16.53,22.4,28.78,29.56,12.91,7.55,27.7,11.34,42.69,10.87,2.61-.02,5.1-.11,7.53-.19,5.22-.18,10.15-.35,13.58.3,6.87,1.3,12.49,4.22,16.98,10.64l4.64,6.66c2.56,3.67,7.61,4.57,11.27,2.01h0s-8.1-11.62-8.1-11.62c-5.69-8.13-14.4-13.98-23.3-15.65-4.32-.81-9.68-.63-15.39-.43-2.37.08-4.82.17-7.34.19h-.09c-.75.03-1.5.04-2.25.04-25.71,0-50-14.22-61.89-36.23-7.77-14.32-10.01-31.26-6.45-49.03,4.54-23.81,18.19-45.57,38.44-61.27,19.68-15.26,43.79-23.48,67.96-23.16,18.06.08,35.17,4.36,50.86,12.72,14.74,7.86,27.7,19.27,37.5,32.99,9.86,13.81,16.48,29.92,19.14,46.58,2.82,17.68,1.31,35.37-4.53,52.62-5.12,15.75-13.42,28.72-24.67,38.57l4.66,6.68h.01c12.71-10.89,22.03-25.28,27.69-42.7,6.24-18.46,7.87-37.45,4.84-56.44Z"/>
                    <path fill="white" d="M107.41,155.46c-6.82-1.29-13.74-1.05-20.43-.81-2.31.08-4.7.16-7.01.18h-.12c-17.84.64-35.33-9.06-43.48-24.19-6.57-12.08-5.86-24.97-4.1-33.7,7.1-37.54,43.84-66.48,83.68-65.88,28.09.09,53.56,13.24,69.88,36.1,16.46,23.06,20.66,51.7,11.51,78.65-3.51,10.87-8.94,19.87-16.13,26.79l4.68,6.72h0c8.62-7.96,15.07-18.4,19.12-30.95,9.99-29.39,5.39-60.7-12.6-85.9-17.85-25-45.72-39.4-76.4-39.49-43.63-.66-83.9,31.18-91.7,72.42-2.9,14.34-1.19,27.86,4.92,39.11,9.72,18.03,29.68,29.18,50.84,28.43,2.4-.02,4.83-.1,7.18-.18,6.54-.23,12.71-.44,18.65.68,12.82,2.41,24.75,10.35,32.74,21.76l12.61,18.09c2.56,3.67,7.61,4.57,11.27,2.01h0s-17.24-24.74-17.24-24.74c-9.2-13.14-23-22.28-37.88-25.08Z"/>
                  </g>
                  {/* Eyes — sit just below the logo mark */}
                  <ellipse cx="31" cy="56" rx="2.8" ry="3" fill="white" opacity="0.95"/>
                  <ellipse cx="49" cy="56" rx="2.8" ry="3" fill="white" opacity="0.95"/>
                  <circle cx="31.9" cy="56.8" r="1.3" fill="rgba(30,58,138,0.85)"/>
                  <circle cx="49.9" cy="56.8" r="1.3" fill="rgba(30,58,138,0.85)"/>
                  {/* Smile */}
                  <path d="M28 64 Q40 71 52 64" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.9"/>
                </svg>
              </div>
              <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-slate-950"></div>
            </div>
          </div>
          <div className="flex items-center justify-center space-x-2 mb-6">
            <div className="w-8 h-[1px] bg-blue-500"></div>
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-500">Meet Bridget</span>
            <div className="w-8 h-[1px] bg-blue-500"></div>
          </div>
          <h2 className="text-4xl font-black text-white tracking-tighter uppercase leading-tight mb-4">
            Your program advisor.<br />
            <span className="text-blue-500">Always in context.</span>
          </h2>
          <p className="text-slate-400 text-base font-medium leading-relaxed mb-10 max-w-xl mx-auto">
            One click. Bridget already knows your PFMEA, your BOM, and your gate — and checks the outside world before she answers.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mb-10">
            {["Am I ready for CDR?", "What's blocking my RAMP score?", "Should I explore an alternative supplier?"].map((q) => (
              <div key={q} className="bg-slate-900 border border-slate-700 px-5 py-3 text-slate-300 text-sm font-medium italic">
                "{q}"
              </div>
            ))}
          </div>
          <p className="text-slate-600 text-xs font-semibold uppercase tracking-widest">
            Available inside every project — no setup required.
          </p>
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
                Most tools reset when a project closes. Your next team starts from zero.
              </p>
              <p className="text-slate-900 text-base font-black leading-relaxed uppercase tracking-wide">
                BridgeOps remembers.<br />Every project makes the next one smarter.
              </p>
            </div>

            <div className="space-y-px border border-slate-200 shadow-sm">
              {[
                {
                  stage: 'After project 1',
                  color: 'bg-slate-100',
                  labelColor: 'text-slate-500',
                  title: 'You stop losing knowledge.',
                  body: 'Baseline established. Patterns start forming.',
                },
                {
                  stage: 'After project 3',
                  color: 'bg-blue-50',
                  labelColor: 'text-blue-600',
                  title: 'Cross-project signals activate.',
                  body: 'Blind spots disappear.',
                },
                {
                  stage: 'After project 5+',
                  color: 'bg-slate-900',
                  labelColor: 'text-blue-400',
                  title: 'Your team learns from itself.',
                  body: 'Org-level memory. Every launch gets faster.',
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
                Invitation Only · Annual License or Engagement
              </span>
              <h2 className="text-3xl md:text-5xl font-black text-white uppercase tracking-tighter leading-none mb-6">
                Ready to See It <br />
                <span className="text-blue-500">In Your Program?</span>
              </h2>
              <p className="text-slate-400 text-base font-medium leading-relaxed">
                BridgeOps Intelligence ships with every BridgeOps engagement — you get the full
                platform from day one. It's also available as a standalone annual license for teams
                that want it independently. Either way, access is invitation-only. Reach out and
                I'll review your program personally.
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
