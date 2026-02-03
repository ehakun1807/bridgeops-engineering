import React from 'react';
import { Search, Shield, Target, ClipboardCheck, ArrowRight, Activity, Users, Zap } from 'lucide-react';

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
      color: 'blue',
      icon: Search,
      bg: 'bg-blue-50',
      border: 'border-blue-200',
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
      color: 'indigo',
      icon: Users,
      bg: 'bg-indigo-50',
      border: 'border-indigo-200',
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
      color: 'slate',
      icon: Target,
      bg: 'bg-slate-900',
      border: 'border-slate-800',
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
            <span className="text-blue-400 font-black uppercase tracking-[0.4em] text-xs">Engagement Model</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-black text-white tracking-tighter mb-8 leading-tight">
            Our <span className="text-blue-500">Three Layers</span> <br/> of Activity.
          </h1>
          <p className="text-slate-400 text-xl font-medium max-w-2xl mx-auto">
            A structured approach to turning technical innovation into operational reality, scaling from diagnosis to full-scale ownership.
          </p>
        </div>
      </section>

      {/* Layers Content */}
      <section className="py-24 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-16">
            {layers.map((layer, index) => (
              <div 
                key={layer.id}
                className={`flex flex-col lg:flex-row gap-12 items-stretch rounded-none overflow-hidden ${layer.bg} border-l-8 ${layer.accent.replace('bg-', 'border-')} shadow-xl transition-transform hover:-translate-y-1`}
              >
                {/* Visual Label / Number */}
                <div className={`lg:w-1/6 flex flex-col items-center justify-center p-12 ${layer.accent} text-white`}>
                  <span className="text-sm font-black uppercase tracking-widest opacity-60 mb-2">Layer</span>
                  <span className="text-8xl font-black tracking-tighter leading-none">{layer.id}</span>
                  <layer.icon size={48} className="mt-8 opacity-40" />
                </div>

                {/* Content */}
                <div className="lg:w-5/6 p-12 lg:p-20">
                  <div className="mb-10">
                    <h2 className={`text-4xl font-black ${layer.text} tracking-tight mb-2 uppercase`}>{layer.title}</h2>
                    <p className={`text-xl font-bold ${layer.text} opacity-60 italic mb-6`}>{layer.subtitle}</p>
                    <div className="flex items-start gap-3 p-4 bg-white/40 backdrop-blur-sm rounded-lg border border-white/50 mb-8 max-w-3xl">
                      <Zap className="text-blue-600 flex-shrink-0 mt-1" size={18} />
                      <p className={`font-bold ${layer.text}`}>Goal: <span className="font-medium opacity-80">{layer.goal}</span></p>
                    </div>
                    <p className={`text-lg ${layer.text} opacity-80 leading-relaxed max-w-4xl`}>
                      {layer.description}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {layer.items.map((item, i) => (
                      <div key={i} className={`flex items-center space-x-4 p-5 rounded-sm bg-white border border-slate-100 shadow-sm hover:shadow-md transition-shadow`}>
                        <div className={`w-2 h-2 rounded-full ${layer.accent}`}></div>
                        <span className="text-slate-800 font-bold text-sm tracking-tight">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Call to Action */}
          <div className="mt-24 text-center">
            <div className="inline-block p-12 bg-slate-900 rounded-none border border-slate-800 shadow-2xl relative overflow-hidden group">
              <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
              <h3 className="text-3xl font-black text-white relative z-10 mb-4 tracking-tighter">Ready to initiate Layer 1?</h3>
              <p className="text-slate-400 mb-8 relative z-10 font-medium">Let's map your operational roadmap and identify the bottlenecks holding you back.</p>
              <a 
                href="#contact" 
                className="inline-flex items-center bg-blue-600 text-white px-10 py-5 font-black uppercase tracking-[0.2em] text-sm hover:bg-blue-700 transition-all relative z-10"
              >
                Schedule Diagnostic <ArrowRight className="ml-3" size={18} />
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default MethodologyLayers;