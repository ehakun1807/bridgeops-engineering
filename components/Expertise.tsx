
import React from 'react';
import { Award, Briefcase, GraduationCap } from 'lucide-react';

const Expertise: React.FC = () => {
  return (
    <section id="expertise" className="py-24 bg-slate-50 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          
          <div>
            <h2 className="text-4xl font-bold text-slate-900 mb-8 leading-tight">
              A Proven Track Record in <br/><span className="text-blue-600">Complex Global Operations.</span>
            </h2>
            <p className="text-lg text-slate-600 mb-10 leading-relaxed">
              With over 15 years of multi-disciplinary experience at <strong>global industry leaders</strong>, I specialize in building operational domains from the ground up and scaling them to international standards.
            </p>

            <div className="space-y-8">
              <div className="flex gap-6">
                <div className="flex-shrink-0 bg-blue-100 p-4 rounded-2xl text-blue-600 h-fit">
                  <GraduationCap size={32} />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-slate-900 mb-2">Academic Foundation</h4>
                  <p className="text-slate-600">Master of Engineering (M.E.) and B.Sc. in Industrial Engineering from the <strong>Technion - Israel Institute of Technology</strong>.</p>
                </div>
              </div>

              <div className="flex gap-6">
                <div className="flex-shrink-0 bg-blue-100 p-4 rounded-2xl text-blue-600 h-fit">
                  <Briefcase size={32} />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-slate-900 mb-2">Leadership Experience</h4>
                  <p className="text-slate-600">Leading multidisciplinary R&D teams and OPS Engineering departments to deliver innovative products and high-yield production lines.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 bg-blue-500/10 rounded-3xl blur-2xl transform rotate-3"></div>
            <div className="relative bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
              <h3 className="text-2xl font-bold mb-8 flex items-center">
                <Briefcase className="text-blue-600 mr-2" />
                Operational Focus
              </h3>
              
              <p className="text-slate-600 mb-8 leading-relaxed">
                Expertise spans across highly regulated industries, managing the critical path from concept to commercialization with a focus on DFX, cost-reduction, and quality systems.
              </p>

              <div className="space-y-4">
                <div className="flex items-center space-x-3 text-slate-700 font-medium">
                  <div className="w-1.5 h-1.5 bg-blue-600 rounded-full"></div>
                  <span>Operational Domain Building</span>
                </div>
                <div className="flex items-center space-x-3 text-slate-700 font-medium">
                  <div className="w-1.5 h-1.5 bg-blue-600 rounded-full"></div>
                  <span>Lifecycle Management (PLM/PDM)</span>
                </div>
                <div className="flex items-center space-x-3 text-slate-700 font-medium">
                  <div className="w-1.5 h-1.5 bg-blue-600 rounded-full"></div>
                  <span>Strategic NPI & Scaling</span>
                </div>
                <div className="flex items-center space-x-3 text-slate-700 font-medium">
                  <div className="w-1.5 h-1.5 bg-blue-600 rounded-full"></div>
                  <span>Process Optimization & Cost Recovery</span>
                </div>
              </div>

              <div className="mt-12 p-6 bg-slate-900 rounded-2xl text-white">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">Global Reach</span>
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                  </div>
                </div>
                <p className="font-medium">Managing multi-site contractors, international suppliers, and complex global repair centers.</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};

export default Expertise;
