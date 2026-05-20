// ---------------------------------------------------------------------------
// Engagements page (still routed as `pricing` to keep URLs and back-links
// stable). The product is the consulting engagement, not the SaaS tool —
// BridgeOps.ENGINEERING is infrastructure that ships with every engagement.
//
// Three tiers, each routed to its own conversion path:
//   1. Self-Service Audit         → /ramp-score
//   2. Expert NPI Readiness Audit → discovery call (contact)
//   3. Ramp Leadership            → discovery call (contact)
//
// FAQ + bottom CTA give late-page visitors a second conversion surface.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import {
  Check,
  ArrowRight,
  Shield,
  Rocket,
  Compass,
  Users,
  Calendar,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { NavigateFn } from './types';

interface PricingProps {
  onSelectPlan: (plan: string) => void;
  onNavigate?: NavigateFn;
}

interface Engagement {
  name: string;
  // Maps the engagement back to the BridgeOps methodology
  // (ASSESS · ALIGN · BUILD · SCALE). Rendered as a small uppercase
  // tag at the top of each card so a visitor coming from /methodology
  // can instantly see which stage(s) this tier covers.
  stageTag: string;
  tagline: string;
  bestFor: string;
  badge: string;
  badgeColor: string;
  icon: React.ReactNode;
  price: string;
  period: string;
  features: string[];
  ctaLabel: string;
  ctaTarget: 'ramp_score' | 'contact';
  emphasized?: boolean;
}

const engagements: Engagement[] = [
  {
    name: 'Self-Service Audit',
    stageTag: 'Stage 1 — Assess',
    tagline:
      'Run a structured 10-parameter ramp readiness audit on your own product. AI-generated risk analysis, standards & compliance context, and a downloadable PDF in under 30 minutes.',
    bestFor:
      'Founders and ops leads who want a structured gut-check before bringing someone in.',
    badge: 'Available Now',
    badgeColor: 'bg-green-600',
    icon: <Compass className="text-blue-500" size={28} />,
    price: 'Free',
    period: 'Self-Service',
    features: [
      'Self-generated Ramp Readiness Score',
      '10-parameter diagnostic breakdown',
      'AI-generated risk analysis',
      'Standards & compliance context',
      'PDF export of your audit'
    ],
    ctaLabel: 'Start a Free Audit',
    ctaTarget: 'ramp_score'
  },
  {
    name: 'Expert NPI Readiness Audit',
    stageTag: 'Stages 1–2 — Assess + Align',
    tagline:
      'A senior-led, hands-on audit of your manufacturing readiness — interviews, document review, BOM and supplier evaluation, gate-by-gate scoring, and a written prioritized action plan.',
    bestFor:
      'Companies approaching pilot or design freeze who want a senior outside perspective before committing to ramp investments.',
    badge: 'Most Common',
    badgeColor: 'bg-blue-600',
    icon: <Rocket className="text-blue-500" size={28} />,
    price: 'On Request',
    period: '2-Week Engagement',
    features: [
      'Stakeholder interviews (R&D, QA, Ops, Supply)',
      'Document, BOM & process review',
      'Full Ramp Readiness Score across CR → MP gates',
      'Production Readiness Blueprint with prioritized actions',
      '60-min strategic readout with leadership',
      'BridgeOps platform included'
    ],
    ctaLabel: 'Book a Discovery Call',
    ctaTarget: 'contact',
    emphasized: true
  },
  {
    name: 'Ramp Leadership',
    stageTag: 'Stages 2–4 — Align · Build · Scale',
    tagline:
      'Embedded fractional NPI leadership through pilot builds and into stable production. I run the cross-functional layer between R&D, quality, operations, and supply chain so the ramp runs predictably rather than dramatically.',
    bestFor:
      'Companies in active ramp who need a senior operator owning the end-to-end picture, not just an advisor.',
    badge: 'For Active Ramps',
    badgeColor: 'bg-slate-900',
    icon: <Users className="text-slate-700" size={28} />,
    price: 'Custom',
    period: '3–6 Months',
    features: [
      'Fractional NPI ownership through pilot → MP',
      'NPI Execution Plan tied to CR → MP gates',
      'DFM, validation, supplier qualification, yield ramp',
      'Continuous readiness tracking via BridgeOps',
      'Direct access between sessions',
      'Bi-weekly readouts toward Stable Production Ramp'
    ],
    ctaLabel: 'Book a Discovery Call',
    ctaTarget: 'contact'
  }
];

const faqs: Array<{ q: string; a: string }> = [
  {
    q: 'Why not buy NPI consulting from a large firm?',
    a: "Large firms send junior consultants to learn on your project. I'm one operator with 20+ years of hands-on NPI and operations experience across regulated hardware. You're hiring the senior who will do the work, not a slide deck."
  },
  {
    q: 'How long does the Expert Audit actually take?',
    a: 'Two weeks of elapsed time, with roughly 25–35 hours of focused work. Week one is interviews and review, week two is the readout and written deliverables. Faster timelines are possible for narrower scopes — discussed in the discovery call.'
  },
  {
    q: 'Do you sign NDAs?',
    a: 'Always. NDA before any meaningful conversation, and a written MSA + SOW before any paid engagement begins.'
  },
  {
    q: 'Which industries do you focus on?',
    a: 'MedTech, diagnostics, and industrial IoT — Seed through Series C. Hardware programs that operate under regulated quality systems (ISO 13485, ISO 9001, ATEX/ISO 80079) or are heading there.'
  },
  {
    q: 'How does Ramp Leadership pricing work?',
    a: "It's a monthly retainer scoped to your stage and objectives, typically running 3 to 6 months. We agree on scope, gates, and deliverables before signing — no surprises."
  },
  {
    q: 'What if I just want to talk first?',
    a: "That's what the discovery call is for — 30 minutes, no commitment. I learn the situation, you decide if there's a fit, and we go from there."
  }
];

const Pricing: React.FC<PricingProps> = ({ onSelectPlan, onNavigate }) => {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const handleCta = (eng: Engagement) => {
    if (eng.ctaTarget === 'ramp_score') {
      onNavigate?.('ramp_score');
    } else {
      onSelectPlan(eng.name);
      onNavigate?.('contact');
    }
  };

  return (
    <div className="py-24 bg-[#fcfcfd] relative overflow-hidden">
      <div className="absolute inset-0 blueprint-grid opacity-[0.03] pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Header ----------------------------------------------------------- */}
        <div className="text-center max-w-3xl mx-auto mb-20">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-blue-600 font-black uppercase tracking-[0.4em] text-[10px] mb-4 block"
          >
            How We Work · Engagements
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-6xl font-black text-slate-900 tracking-tighter uppercase leading-none mb-6"
          >
            Three Ways <br />
            <span className="text-blue-600 italic">to Work Together.</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-slate-500 text-lg font-medium leading-relaxed"
          >
            Pick the level of engagement that matches your stage — from a free
            self-service audit you can run in 30 minutes, to embedded ramp
            leadership through pilot builds and into stable production.
          </motion.p>
        </div>

        {/* Engagement cards ------------------------------------------------- */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {engagements.map((eng, index) => (
            <motion.div
              key={eng.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 + 0.3 }}
              className={`relative flex flex-col bg-white border p-8 rounded-sm transition-all ${
                eng.emphasized
                  ? 'border-blue-600 shadow-2xl md:scale-105 z-20'
                  : 'border-slate-200 shadow-xl'
              }`}
            >
              <div
                className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 ${eng.badgeColor} text-white text-[9px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full flex items-center gap-2`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                {eng.badge}
              </div>

              <div className="mb-8">
                <div className="mb-4">{eng.icon}</div>
                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-600 mb-2">
                  {eng.stageTag}
                </p>
                <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tighter mb-2">
                  {eng.name}
                </h3>
                <p className="text-slate-500 text-sm font-medium leading-relaxed mb-6">
                  {eng.tagline}
                </p>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-3xl font-black text-slate-900">{eng.price}</span>
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">
                    / {eng.period}
                  </span>
                </div>
                <div className="text-[10px] font-semibold text-slate-500 leading-relaxed border-l-2 border-blue-200 pl-3 italic">
                  Best for: {eng.bestFor}
                </div>
              </div>

              <div className="flex-grow space-y-4 mb-8">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">
                  What's Included
                </p>
                {eng.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-3">
                    <Check size={14} className="mt-1 flex-shrink-0 text-blue-500" />
                    <span className="text-slate-600 text-xs font-semibold leading-tight">
                      {feature}
                    </span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => handleCta(eng)}
                aria-label={`${eng.ctaLabel} — ${eng.name}`}
                className={`w-full py-4 px-6 font-black uppercase tracking-widest text-[10px] transition-all flex items-center justify-center group shadow-lg ${
                  eng.emphasized
                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-500/20'
                    : 'bg-slate-900 text-white hover:bg-slate-800 shadow-slate-900/10'
                }`}
              >
                {eng.ctaTarget === 'contact' && (
                  <Calendar size={12} className="mr-2.5" />
                )}
                {eng.ctaLabel}
                <ArrowRight
                  size={14}
                  className="ml-3 group-hover:translate-x-1 transition-transform"
                />
              </button>
            </motion.div>
          ))}
        </div>

        {/* Track Record ---------------------------------------------------- */}
        <div className="mt-20">
          <div className="flex items-center space-x-2 mb-8">
            <div className="w-10 h-[1px] bg-blue-600" />
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">Proven in the Field</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                label: 'IoT Hardware Scale-up',
                text: 'Built and led the NPI function from scratch at a fast-scaling IoT hardware company — established production lines within 2 quarters each, reaching >95% first-pass yield. Drove PLM implementation and a full KPI framework within the same timeframe.',
              },
              {
                label: 'MedTech — Class II/III Devices',
                text: 'Over 10 years at MedTech organizations, owned product transfer from R&D to manufacturing for Class II/III medical devices — from supplier qualification and validation through production line establishment and calibration system introduction — under FDA and ISO 13485 requirements.',
              },
            ].map((item) => (
              <div key={item.label} className="bg-slate-50 border border-slate-200 p-8">
                <div className="w-6 h-[2px] bg-blue-600 mb-4" />
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-3">{item.label}</p>
                <p className="text-slate-600 text-sm font-medium leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Trust strip ------------------------------------------------------ */}
        <div className="mt-20 pt-10 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-6 text-center md:text-left">
            <div className="flex items-center space-x-3 px-4 py-2 border border-slate-200 bg-slate-50 flex-shrink-0">
              <Shield size={16} className="text-blue-600" />
              <span className="text-slate-700 text-[10px] font-black uppercase tracking-widest">
                ISO 9001 / 13485 / ATEX Aware
              </span>
            </div>
            <p className="text-slate-500 text-[11px] font-semibold leading-relaxed max-w-xl">
              Engagements grounded in <span className="text-slate-900 font-bold">20+ years</span> of
              NPI, manufacturing ramp, and operations leadership across medical, industrial, and
              electro-mechanical hardware programs. NDA and written MSA + SOW before any paid
              engagement.
            </p>
          </div>
        </div>

        {/* FAQ -------------------------------------------------------------- */}
        <div className="mt-24">
          <div className="text-center mb-12">
            <span className="text-blue-600 font-black uppercase tracking-[0.4em] text-[10px] mb-4 block">
              Frequently Asked
            </span>
            <h3 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tighter uppercase">
              Common Questions
            </h3>
          </div>

          <div className="max-w-3xl mx-auto space-y-3">
            {faqs.map((faq, i) => {
              const isOpen = openFaq === i;
              return (
                <div
                  key={faq.q}
                  className={`border bg-white transition-colors ${
                    isOpen ? 'border-blue-600 shadow-lg' : 'border-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : i)}
                    className="w-full text-left flex items-center justify-between gap-4 px-5 py-4"
                    aria-expanded={isOpen}
                  >
                    <span className="text-slate-900 font-black text-sm leading-snug uppercase tracking-tight">
                      {faq.q}
                    </span>
                    <ChevronDown
                      size={16}
                      className={`flex-shrink-0 transition-transform ${
                        isOpen ? 'rotate-180 text-blue-600' : 'text-slate-400'
                      }`}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <p className="px-5 pb-5 text-slate-600 text-[13px] leading-relaxed font-medium">
                          {faq.a}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom CTA ------------------------------------------------------- */}
        <div className="mt-20 max-w-3xl mx-auto text-center bg-slate-900 text-white p-12 rounded-sm relative overflow-hidden">
          <div className="absolute inset-0 blueprint-grid opacity-[0.05] pointer-events-none" />
          <div className="relative z-10">
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-400 mb-4">
              Not Sure Which Fits?
            </p>
            <h3 className="text-2xl md:text-3xl font-black tracking-tight uppercase leading-tight mb-5">
              Let's talk it through.
            </h3>
            <p className="text-slate-300 text-sm font-medium leading-relaxed mb-8 max-w-xl mx-auto">
              30 minutes, no commitment. I'll learn the situation, point to the engagement that
              fits, or tell you honestly if there isn't one yet.
            </p>
            <button
              onClick={() => {
                onSelectPlan('Discovery Call');
                onNavigate?.('contact');
              }}
              className="inline-flex items-center gap-3 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest text-[10px] px-8 py-4 transition-colors shadow-lg shadow-blue-500/20"
            >
              <Calendar size={14} />
              Book a Discovery Call
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Pricing;
