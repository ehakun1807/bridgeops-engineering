import React from 'react';
import { Search, Shield, Target, ClipboardCheck, ArrowRight, Activity, Users, Zap, CheckCircle2, AlertCircle, BarChart3, Clock } from 'lucide-react';

const MethodologyLayers: React.FC = () => {
  const layers = [
    {
      id: 1,
      title: 'Diagnostic & Alignment',
      subtitle: 'Smart Entry Strategy',
      goal: 'To diagnose, map, and define a concrete action plan.',
      description: 'The foundation of any successful transition. We deep-dive into the existing ecosystem to identify the actual path to production.',
      items: [
        'R&D ⇄ Ops ⇄ Supply Chain Review',
        'NPI Bottleneck Identification',
        'Production & Scaling Readiness Assessment',
        'Risk Mapping + Operational Roadmap'
      ],
      icon: Search,
      bg: 'bg-blue-50',
      text: 'text-blue-900',
      accent: 'bg-blue-600'
    },
    {
      id: 2,
      title: 'Fractional Leadership & Execution',
      subtitle: 'Hands-on Management',
      goal: 'Creating operational stability and excellence through active leadership.',
      description: 'We don\'t just advise from the sidelines. We take fractional ownership of the operations function to lead your team to the finish line.',
      items: [
        'End-to-End NPI Management',
        'Infrastructure Setup (PLM, KPIs, Processes)',
        'Building Production Lines, Vendors & Routines',
        'Direct Interface with Senior Management',
        'Operational Domain Leadership'
      ],
      icon: Users,
      bg: 'bg-indigo-50',
      text: 'text-indigo-900',
      accent: 'bg-indigo-600'
    },
    {
      id: 3,
      title: 'Projects with Clear Ownership',
      subtitle: 'Outcome-Driven Excellence',
      goal: 'Executing specialized engineering projects with defined milestones.',
      description: 'Specific high-impact initiatives where we take full accountability for the delivery and stabilization of production assets.',
      items: [
        'New Production Line Setup',
        'Product Transfer to Contract Manufacturer (CM)',
        'Yield Stabilization & Optimization Sprints',
        'Establishment of OPS / NPI Functions'
      ],
      icon: Target,
      bg: 'bg-slate-900',
      text: 'text-white',
      accent: 'bg-blue-500'
    }
  ];

  return (
    <div className="bg-white">
      {/* Header Section */}
      <section className="bg-slate-950 py-24 text-center relative overflow-hidden">
        <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
        <div className="max-w-4xl mx-auto px-4 relative z-10">
          <div className="flex items-center justify-center space-x-3 mb-6">
            <Activity className="text-blue-500" size={24} />
            <span className="text-blue-400 font-black uppercase tracking-[0.4em] text-xs">The OpsBridge Method</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-black text-white tracking-tighter mb-8 leading-tight">
            Three Layers of <br/><span className="text-blue-500">Operational Excellence</span>
          </h1>
          <p className="text-slate-400 text-lg font-medium max-w-2xl mx-auto leading-relaxed">
            Bridging the critical gap between prototype and mass production through an engagement model that blends strategy with hands-on engineering execution.
          </p>
        </div>
      </section>

      {/* Comparison Section - The Added Value */}
      <section className="py-20 bg-slate-50 border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Why OpsBridge?</h2>
            <p className="text-slate-500 mt-2 text-sm">The difference between "Advice" and "Execution"</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-200 border border-slate-200 rounded-none overflow-hidden shadow-2xl">
            <div className="bg-white p-12">
              <div className="flex items-center space-x-3 mb-8 text-slate-400">
                <AlertCircle size={24} />
                <h3 className="text-lg font-black uppercase tracking-widest">Traditional Consultants</h3>
              </div>
              <ul className="space-y-6">
                <li className="flex items-start text-slate-500 font-medium text-sm">
                  <XIcon className="text-red-400 mt-1 mr-3" />
                  <span>Theoretical reports and Powerpoint slides</span>
                </li>
                <li className="flex items-start text-slate-500 font-medium text-sm">
                  <XIcon className="text-red-400 mt-1 mr-3" />
                  <span>No accountability for final yield or TTM</span>
                </li>
                <li className="flex items-start text-slate-500 font-medium text-sm">
                  <XIcon className="text-red-400 mt-1 mr-3" />
                  <span>Leaves the execution to the internal team</span>
                </li>
              </ul>
            </div>
            
            <div className="bg-slate-900 p-12 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4">
                <div className="bg-blue-600 text-white text-[9px] font-black px-3 py-1 uppercase tracking-widest">The Partner Way</div>
              </div>
              <div className="flex items-center space-x-3 mb-8 text-blue-500">
                <CheckCircle2 size={24} />
                <h3 className="text-lg font-black uppercase tracking-widest">OpsBridge Engineering</h3>
              </div>
              <ul className="space-y-6">
                <li className="flex items-start text-white font-bold text-sm">
                  <CheckIcon className="text-blue-500 mt-1 mr-3" />
                  <span>Hands-on management within your PLM/ERP</span>
                </li>
                <li className="flex items-start text-white font-bold text-sm">
                  <CheckIcon className="text-blue-500 mt-1 mr-3" />
                  <span>Full ownership of manufacturing engineering</span>
                </li>
                <li className="flex items-start text-white font-bold text-sm">
                  <CheckIcon className="text-blue-500 mt-1 mr-3" />
                  <span>Direct linkage to Business KPIs & ROI</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Layers Content */}
      <section className="py-24 relative bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-16">
            {layers.map((layer) => (
              <div 
                key={layer.id}
                className={`flex flex-col lg:flex-row gap-12 items-stretch rounded-none overflow-hidden ${layer.bg} border-l-8 ${layer.accent.replace('bg-', 'border-')} shadow-xl transition-transform hover:-translate-y-1`}
              >
                {/* Visual Label / Number */}
                <div className={`lg:w-1/6 flex flex-col items-center justify-center p-12 ${layer.accent} text-white`}>
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-2">Layer</span>
                  <span className="text-7xl font-black tracking-tighter leading-none">{layer.id}</span>
                  <layer.icon size={40} className="mt-8 opacity-40" />
                </div>

                {/* Content */}
                <div className="lg:w-5/6 p-12 lg:p-20">
                  <div className="mb-10">
                    <h2 className={`text-3xl font-black ${layer.text} tracking-tight mb-2 uppercase`}>{layer.title}</h2>
                    <p className={`text-lg font-bold ${layer.text} opacity-60 italic mb-6`}>{layer.subtitle}</p>
                    <div className="flex items-start gap-3 p-4 bg-white/40 backdrop-blur-sm rounded-lg border border-white/50 mb-8 max-w-3xl">
                      <Zap className="text-blue-600 flex-shrink-0 mt-1" size={16} />
                      <p className={`font-bold ${layer.text} text-sm`}>Impact: <span className="font-medium opacity-80">{layer.goal}</span></p>
                    </div>
                    <p className={`text-base ${layer.text} opacity-80 leading-relaxed max-w-4xl font-medium`}>
                      {layer.description}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {layer.items.map((item, i) => (
                      <div key={i} className={`flex items-center space-x-4 p-5 rounded-sm bg-white border border-slate-100 shadow-sm hover:shadow-md transition-shadow`}>
                        <CheckCircle2 size={16} className="text-blue-600 flex-shrink-0" />
                        <span className="text-slate-800 font-bold text-sm tracking-tight">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ROI Stats Section */}
          <div className="mt-32 grid grid-cols-1 md:grid-cols-3 gap-12 border-t border-slate-100 pt-20">
            <div className="text-center">
              <Clock className="mx-auto text-blue-600 mb-4" size={32} />
              <h4 className="text-xl font-black text-slate-900 mb-2 uppercase">Faster TTM</h4>
              <p className="text-slate-500 font-medium uppercase tracking-widest text-[9px]">Reduced Time-to-Market</p>
            </div>
            <div className="text-center">
              <BarChart3 className="mx-auto text-blue-600 mb-4" size={32} />
              <h4 className="text-xl font-black text-slate-900 mb-2 uppercase">COGS Reduction</h4>
              <p className="text-slate-500 font-medium uppercase tracking-widest text-[9px]">Optimized unit cost</p>
            </div>
            <div className="text-center">
              <Shield className="mx-auto text-blue-600 mb-4" size={32} />
              <h4 className="text-xl font-black text-slate-900 mb-2 uppercase">99% Stability</h4>
              <p className="text-slate-500 font-medium uppercase tracking-widest text-[9px]">Production line yield</p>
            </div>
          </div>

          {/* Final CTA */}
          <div className="mt-32 text-center">
            <div className="inline-block p-12 bg-slate-900 rounded-none border border-slate-800 shadow-2xl relative overflow-hidden group">
              <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
              <h3 className="text-2xl font-black text-white relative z-10 mb-4 tracking-tighter uppercase">Initiate Diagnostic Audit</h3>
              <p className="text-slate-400 mb-8 relative z-10 font-medium text-sm">Map your roadmap and identify the bottlenecks holding back your scale.</p>
              <a 
                href="#contact" 
                className="inline-flex items-center bg-blue-600 text-white px-10 py-5 font-black uppercase tracking-[0.2em] text-xs hover:bg-blue-700 transition-all relative z-10"
              >
                Request Analysis <ArrowRight className="ml-3" size={16} />
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

const CheckIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16.6667 5L7.50001 14.1667L3.33334 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const XIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export default MethodologyLayers;