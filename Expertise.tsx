import React from 'react';
import { Award, GraduationCap, Briefcase, Globe, Cpu, Target, Linkedin, ExternalLink, Quote, ArrowRight } from 'lucide-react';

const TRACK_RECORD = [
  {
    label: 'IoT Hardware Scale-up',
    text: 'Built and led the NPI function from scratch at a fast-scaling IoT hardware company — established production lines within 2 quarters each, reaching >95% first-pass yield. Drove PLM implementation and a full KPI framework within the same timeframe.',
  },
  {
    label: 'MedTech — Class II/III Devices',
    text: 'Over 10 years at MedTech organizations, owned product transfer from R&D to manufacturing for Class II/III medical devices — from supplier qualification and validation through production line establishment and calibration system introduction — under FDA and ISO 13485 requirements.',
  },
];

const Expertise: React.FC = () => {
  const linkedInUrl = 'https://www.linkedin.com/in/eran-hakun-81a80a1b';

  return (
    <section id="expertise" className="py-20 bg-white overflow-hidden text-left">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* ── Main grid: left narrative + right competencies ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-stretch">

          {/* Left column */}
          <div className="flex flex-col justify-center text-left">
            <div className="flex items-center justify-between mb-6">
              <div className="inline-flex items-center space-x-2 bg-blue-50 px-3 py-1 border border-blue-100 w-fit">
                <Globe size={12} className="text-blue-600" />
                <span className="text-[9px] font-black uppercase tracking-widest text-blue-600">Global Operations Expertise</span>
              </div>
              <a
                href={linkedInUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-2 text-blue-600 hover:text-blue-800 transition-colors"
              >
                <Linkedin size={18} />
                <span className="text-[10px] font-black uppercase tracking-widest">LinkedIn Profile</span>
                <ExternalLink size={10} />
              </a>
            </div>

            {/* Photo + headline */}
            <div className="flex items-center gap-6 mb-6">
              <div className="relative flex-shrink-0">
                <div className="absolute -inset-1 bg-blue-600/20 blur-md rounded-full" />
                <img
                  src="/eran-hakun.jpg"
                  alt="Eran Hakun — NPI & Operations Engineering"
                  className="relative w-20 h-20 rounded-full object-cover object-top border-2 border-blue-600/40 shadow-lg"
                />
              </div>
              <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-0 leading-tight tracking-tighter uppercase text-left">
                A Proven Track Record in <span className="text-blue-600">Complex Systems.</span>
              </h2>
            </div>

            <p className="text-base text-slate-600 mb-3 leading-relaxed font-medium text-left">
              After 20+ years inside global companies and fast-scaling startups, I kept seeing the same gap. Teams with great products losing months and millions at the handoff between engineering and manufacturing. Not because the problems were unsolvable, but because the operational bridge between engineering and manufacturing has never been a first-class priority — until something breaks.
            </p>
            <p className="text-base font-black text-slate-900 tracking-tight mb-6 text-left">
              BridgeOps is how I've chosen to resolve it.
            </p>

            <div className="space-y-8 text-left">
              <div className="flex gap-6 group text-left">
                <div className="flex-shrink-0 bg-slate-900 p-3 text-white h-fit transition-transform group-hover:-translate-y-1">
                  <GraduationCap size={24} />
                </div>
                <div>
                  <h4 className="text-base font-black text-slate-900 mb-1 uppercase tracking-tight">Academic Foundation</h4>
                  <p className="text-sm text-slate-500 leading-snug">Master of Engineering (M.E.) and B.Sc. in Industrial Engineering from the <strong className="text-slate-900">Technion - Israel Institute of Technology</strong>.</p>
                </div>
              </div>

              <div className="flex gap-6 group text-left">
                <div className="flex-shrink-0 bg-slate-900 p-3 text-white h-fit transition-transform group-hover:-translate-y-1">
                  <Briefcase size={24} />
                </div>
                <div>
                  <h4 className="text-base font-black text-slate-900 mb-1 uppercase tracking-tight">Leadership Experience</h4>
                  <p className="text-sm text-slate-500 leading-snug">Led multidisciplinary NPI and OPS Engineering teams across MedTech and IoT — delivering high-yield production lines and scalable operational infrastructure from the ground up.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right column — Core Competencies */}
          <div className="relative">
            <div className="absolute inset-0 blueprint-grid opacity-20 -z-10 translate-x-4 translate-y-4"></div>
            <div className="relative bg-white p-10 border-2 border-slate-900 shadow-[20px_20px_0px_0px_rgba(15,23,42,0.05)] h-full text-left">
              <div className="flex items-center justify-between mb-10">
                <h3 className="text-xl font-black text-slate-900 flex items-center tracking-tighter uppercase">
                  Core Competencies
                </h3>
                <Target className="text-blue-600" size={20} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-8 gap-x-8 text-left">
                <div className="space-y-3 text-left">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-[1px] bg-blue-600"></div>
                    <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Scalability</span>
                  </div>
                  <h5 className="font-bold text-slate-900 uppercase text-xs">NPI Strategy</h5>
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">Transitioning prototypes to high-yield mass production batches.</p>
                </div>

                <div className="space-y-3 text-left">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-[1px] bg-blue-600"></div>
                    <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Efficiency</span>
                  </div>
                  <h5 className="font-bold text-slate-900 uppercase text-xs">Cost Recovery</h5>
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">Strategic COGS reduction and supply chain optimization sprints.</p>
                </div>

                <div className="space-y-3 text-left">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-[1px] bg-blue-600"></div>
                    <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Compliance</span>
                  </div>
                  <h5 className="font-bold text-slate-900 uppercase text-xs">Quality Ops</h5>
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">Compliance with ISO 9001, ISO 13485 Medical Device, ATEX (Hazardous) standards.</p>
                </div>

                <div className="space-y-3 text-left">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-[1px] bg-blue-600"></div>
                    <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Systems</span>
                  </div>
                  <h5 className="font-bold text-slate-900 uppercase text-xs">PLM Architecture</h5>
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">Designing end-to-end data lifecycle, ECR/ECO workflows and best-in-class document control.</p>
                </div>
              </div>

              <div className="mt-12 pt-8 border-t border-slate-100 flex items-center justify-between text-left">
                <div className="flex items-center space-x-4">
                  <Cpu size={28} className="text-slate-300" />
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-left">Market Exposure</p>
                    <p className="text-xs font-bold text-slate-700 uppercase">Medical • Industrial IoT • Deeptech</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2 text-slate-400">
                  <Award size={14} />
                  <span className="text-[9px] font-black uppercase tracking-widest">US Patent Co-Inventor</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Track Record ── */}
        <div className="mt-24 pt-16 border-t border-slate-100">
          <div className="flex items-center space-x-2 mb-4">
            <div className="w-10 h-[1px] bg-blue-600" />
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">Track Record</span>
          </div>
          <h3 className="text-2xl font-black text-slate-900 tracking-tighter uppercase mb-10">
            Programs Delivered.
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {TRACK_RECORD.map((item) => (
              <div key={item.label} className="bg-slate-50 border border-slate-200 p-8">
                <Quote size={20} className="text-blue-200 mb-4" />
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-3">{item.label}</p>
                <p className="text-slate-600 text-sm font-medium leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Bottom CTA ── */}
        <div className="mt-20 text-center bg-slate-900 text-white p-12 relative overflow-hidden">
          <div className="absolute inset-0 blueprint-grid opacity-[0.05] pointer-events-none" />
          <div className="relative z-10">
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-400 mb-4">Ready to Talk?</p>
            <h3 className="text-2xl font-black uppercase tracking-tighter mb-5">Let's See If There's a Fit.</h3>
            <p className="text-slate-300 text-sm font-medium leading-relaxed mb-8 max-w-md mx-auto">
              30 minutes, no commitment. I'll learn your situation and tell you honestly whether BridgeOps is the right move.
            </p>
            <button className="inline-flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[10px] px-8 py-4 transition-colors shadow-lg shadow-blue-500/20">
              Book a Discovery Call
              <ArrowRight size={14} />
            </button>
          </div>
        </div>

      </div>
    </section>
  );
};

export default Expertise;
