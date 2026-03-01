
import React from 'react';
import { ArrowRight, Hammer, CheckCircle2 } from 'lucide-react';

interface HeroProps {
  onNavigate?: (view: any) => void;
}

const Hero: React.FC<HeroProps> = ({ onNavigate }) => {
  return (
    <div className="relative min-h-screen flex items-center overflow-hidden bg-slate-950">
      <div className="absolute inset-0 z-0">
        <div className="glow-blob w-[500px] h-[500px] bg-blue-600 top-[-10%] left-[-5%]"></div>
        <div className="glow-blob w-[600px] h-[600px] bg-indigo-900 bottom-[-20%] right-[-10%] animation-delay-2000"></div>
        <div className="absolute inset-0 blueprint-grid-dark opacity-30"></div>
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/20 via-slate-950/60 to-slate-950"></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32 text-left">
        <div className="max-w-4xl">
          <div className="flex items-center space-x-3 mb-8">
            <div className="h-[2px] w-12 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]"></div>
            <span className="text-blue-400 text-[10px] font-black uppercase tracking-[0.4em] drop-shadow-sm">Operational Execution Partner</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-black text-white leading-[0.95] mb-8 tracking-tighter uppercase">
            From Prototype <br/>To Production — <br/><span className="text-blue-500 drop-shadow-[0_0_15px_rgba(59,130,246,0.3)]">Without Chaos.</span>
          </h1>
          
          <p className="text-lg md:text-xl text-slate-200 mb-8 leading-relaxed max-w-3xl font-medium border-l-4 border-blue-600 pl-6 py-2">
            OpsBridge helps Hardware Startups and Tech Companies to fix the <span className="text-blue-400 font-bold underline decoration-blue-500/50">Hidden Gaps between Engineering and Manufacturing</span> before they turn into Delays, Overruns and broken teams.
          </p>

          <div className="space-y-4 mb-12 max-w-3xl pl-7">
            <div className="flex items-start space-x-3 group">
              <CheckCircle2 size={20} className="text-blue-500 mt-0.5 flex-shrink-0 group-hover:scale-110 transition-transform" />
              <span className="text-slate-300 font-semibold tracking-tight">Reduce time-to-production and late-stage surprises</span>
            </div>
            <div className="flex items-start space-x-3 group">
              <CheckCircle2 size={20} className="text-blue-500 mt-0.5 flex-shrink-0 group-hover:scale-110 transition-transform" />
              <span className="text-slate-300 font-semibold tracking-tight">Align R&D, Ops and Manufacturing around one execution plan</span>
            </div>
            <div className="flex items-start space-x-3 group">
              <CheckCircle2 size={20} className="text-blue-500 mt-0.5 flex-shrink-0 group-hover:scale-110 transition-transform" />
              <span className="text-slate-300 font-semibold tracking-tight">Hands-on NPI & Ops engineering — not slide-deck consulting</span>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-6">
            <button 
              onClick={() => onNavigate?.('services' as any)}
              className="w-full sm:w-auto bg-blue-600 text-white px-8 py-4 rounded-sm font-bold text-base hover:bg-blue-700 transition-all flex items-center justify-center group uppercase tracking-widest shadow-[0_0_30px_rgba(37,99,235,0.4)] hover:shadow-blue-500/50"
            >
              Our Solutions
              <ArrowRight className="ml-3 group-hover:translate-x-1 transition-transform" size={18} />
            </button>
            <button
              onClick={() => onNavigate?.('contact' as any)}
              className="w-full sm:w-auto flex items-center space-x-3 px-6 py-4 bg-white/5 border border-white/10 rounded-sm hover:bg-white/10 transition-all group/review text-left"
            >
               <Hammer size={16} className="text-blue-400 group-hover/review:rotate-12 transition-transform" />
               <span className="text-white font-bold text-[10px] uppercase tracking-widest">Free 30-minutes Production Readiness Assessment</span>
            </button>
          </div>
        </div>
      </div>
      
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[1px] h-24 bg-gradient-to-b from-blue-500/50 to-transparent"></div>
    </div>
  );
};

export default Hero;
