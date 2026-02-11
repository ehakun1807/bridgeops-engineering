import React from 'react';
import { Award, Briefcase, GraduationCap, Globe, Cpu, Target } from 'lucide-react';

const Expertise: React.FC = () => {
  return (
    <section id="expertise" className="py-20 bg-white overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-stretch">
          
          <div className="flex flex-col justify-center">
            <div className="inline-flex items-center space-x-2 bg-blue-50 px-3 py-1 border border-blue-100 mb-6 w-fit">
              <Globe size={12} className="text-blue-600" />
              <span className="text-[9px] font-black uppercase tracking-widest text-blue-600">Global Operations Expertise</span>
            </div>
            
            <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-6 leading-tight tracking-tighter uppercase">
              A Proven Track Record in <br/><span className="text-blue-600">Complex Systems.</span>
            </h2>
            <p className="text-base text-slate-600 mb-10 leading-relaxed font-medium">
              With 20 years of multi-disciplinary experience at global industry leaders, we bring end-to-end expertise in building operational domains from the ground up and scaling them to international standards.
            </p>

            <div className="space-y-8">
              <div className="flex gap-6 group">
                <div className="flex-shrink-0 bg-slate-900 p-3 text-white h-fit transition-transform group-hover:-translate-y-1">
                  <GraduationCap size={24} />
                </div>
                <div>
                  <h4 className="text-base font-black text-slate-900 mb-1 uppercase tracking-tight">Academic Foundation</h4>
                  <p className="text-sm text-slate-500 leading-snug">Master of Engineering (M.E.) and B.Sc. in Industrial Engineering from the <strong className="text-slate-900">Technion - Israel Institute of Technology</strong>.</p>
                </div>
              </div>

              <div className="flex gap-6 group">
                <div className="flex-shrink-0 bg-slate-900 p-3 text-white h-fit transition-transform group-hover:-translate-y-1">
                  <Briefcase size={24} />
                </div>
                <div>
                  <h4 className="text-base font-black text-slate-900 mb-1 uppercase tracking-tight">Leadership Experience</h4>
                  <p className="text-sm text-slate-500 leading-snug">Leading multidisciplinary R&D teams and OPS Engineering departments to deliver innovative products and high-yield production lines.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 blueprint-grid opacity-20 -z-10 translate-x-4 translate-y-4"></div>
            <div className="relative bg-white p-10 border-2 border-slate-900 shadow-[20px_20px_0px_0px_rgba(15,23,42,0.05)] h-full">
              <div className="flex items-center justify-between mb-10">
                <h3 className="text-xl font-black text-slate-900 flex items-center tracking-tighter uppercase">
                  Core Competencies
                </h3>
                <Target className="text-blue-600" size={20} />
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-8 gap-x-8">
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-[1px] bg-blue-600"></div>
                    <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Scalability</span>
                  </div>
                  <h5 className="font-bold text-slate-900 uppercase text-xs">NPI Strategy</h5>
                  <p className="text-[11px] text-slate-500 leading-relaxed">Transitioning prototypes to high-yield mass production batches.</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-[1px] bg-blue-600"></div>
                    <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Efficiency</span>
                  </div>
                  <h5 className="font-bold text-slate-900 uppercase text-xs">Cost Recovery</h5>
                  <p className="text-[11px] text-slate-500 leading-relaxed">Strategic COGS reduction and supply chain optimization sprints.</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-[1px] bg-blue-600"></div>
                    <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Compliance</span>
                  </div>
                  <h5 className="font-bold text-slate-900 uppercase text-xs">Quality Ops</h5>
                  <p className="text-[11px] text-slate-500 leading-relaxed">Compliance with ISO 9001, 13485 Medical Device, ATEX (Hazardous) standards.</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-[1px] bg-blue-600"></div>
                    <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Systems</span>
                  </div>
                  <h5 className="font-bold text-slate-900 uppercase text-xs">PLM Architecture</h5>
                  <p className="text-[11px] text-slate-500 leading-relaxed">Designing end-to-end data lifecycle and ECR/ECO workflows and Best-in-class Document Control Process.</p>
                </div>
              </div>

              <div className="mt-12 pt-8 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <Cpu size={28} className="text-slate-300" />
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Market Exposure</p>
                    <p className="text-xs font-bold text-slate-700 uppercase">Medical • Industrial • High-Tech</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};

export default Expertise;