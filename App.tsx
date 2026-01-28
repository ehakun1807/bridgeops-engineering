
import React from 'react';
import Navigation from './components/Navigation';
import Hero from './components/Hero';
import ServiceCard from './components/ServiceCard';
import Expertise from './components/Expertise';
import ContactForm from './components/ContactForm';
import Logo from './components/Logo';
import { SERVICES } from './constants';
import { CheckCircle2, Factory, Zap, Target, Clock, Calendar } from 'lucide-react';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#fcfcfd]">
      <Navigation />
      
      <main>
        <Hero />

        {/* Strategic Introduction */}
        <section id="about" className="py-32 bg-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-1/3 h-full blueprint-grid opacity-20 pointer-events-none"></div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="flex flex-col lg:flex-row gap-16 items-start">
              <div className="lg:w-1/2">
                <div className="flex items-center space-x-3 mb-6">
                  <span className="w-2 h-2 bg-blue-600"></span>
                  <p className="text-[11px] font-black text-blue-600 tracking-[0.4em] uppercase">Executive Support</p>
                </div>
                <h2 className="text-5xl font-black text-slate-900 mb-8 leading-[1.1] tracking-tighter">
                  Bridging the Gap Between <br/><span className="text-blue-600">Development & Production.</span>
                </h2>
                <div className="space-y-6">
                  <p className="text-xl text-slate-700 font-medium leading-relaxed">
                    OpsBridge Engineering provides multidisciplinary leadership for startups and mature high-tech companies facing complex operational challenges.
                  </p>
                  <p className="text-lg text-slate-500 font-light leading-relaxed">
                    From early-stage R&D infrastructure to stable mass production and lifecycle sustainment, we provide the technical and operational "bridge" that ensures your product meets its quality, cost, and schedule targets.
                  </p>
                  
                  {/* Flexible Engagement Model */}
                  <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-6 bg-slate-50 border-l-4 border-blue-600">
                      <div className="flex items-center mb-2">
                        <Clock className="text-blue-600 mr-2" size={18} />
                        <h4 className="font-bold text-slate-900">Short-Term Projects</h4>
                      </div>
                      <p className="text-sm text-slate-600">Focused NPI sprints, cost-reduction projects, or PLM implementations to solve immediate bottlenecks.</p>
                    </div>
                    <div className="p-6 bg-slate-50 border-l-4 border-blue-900">
                      <div className="flex items-center mb-2">
                        <Calendar className="text-blue-900 mr-2" size={18} />
                        <h4 className="font-bold text-slate-900">Long-Term Partnerships</h4>
                      </div>
                      <p className="text-sm text-slate-600">Building organizational infrastructure and leading operational domains through sustained growth.</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="lg:w-1/2 grid grid-cols-1 sm:grid-cols-2 gap-px bg-slate-200 border border-slate-200 shadow-2xl rounded-sm overflow-hidden">
                <div className="bg-white p-10 flex flex-col justify-between hover:bg-blue-50 transition-colors duration-500">
                  <div>
                    <Zap className="text-blue-600 mb-6" size={24} />
                    <h4 className="text-lg font-black uppercase mb-3">Early Stage</h4>
                    <p className="text-slate-500 text-sm font-medium">Setting up BOM/PLM/Doc Control from day one.</p>
                  </div>
                </div>
                
                <div className="bg-white p-10 flex flex-col justify-between hover:bg-blue-50 transition-colors duration-500">
                  <div>
                    <Factory className="text-blue-600 mb-6" size={24} />
                    <h4 className="text-lg font-black uppercase mb-3">Scale-Up</h4>
                    <p className="text-slate-500 text-sm font-medium">Optimizing NPI and global supply chain interfaces.</p>
                  </div>
                </div>

                <div className="bg-white p-10 flex flex-col justify-between hover:bg-blue-50 transition-colors duration-500">
                  <div>
                    <Target className="text-blue-600 mb-6" size={24} />
                    <h4 className="text-lg font-black uppercase mb-3">Mature Tech</h4>
                    <p className="text-slate-500 text-sm font-medium">Continuous improvement and COGS reduction.</p>
                  </div>
                </div>

                <div className="bg-white p-10 flex flex-col justify-between hover:bg-blue-50 transition-colors duration-500">
                  <div>
                    <CheckCircle2 className="text-blue-600 mb-6" size={24} />
                    <h4 className="text-lg font-black uppercase mb-3">Compliance</h4>
                    <p className="text-slate-500 text-sm font-medium">ISO 13485, ISO 9001 and Regulatory alignment.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Services Grid */}
        <section id="services" className="py-32 bg-slate-50 border-y border-slate-200 relative overflow-hidden">
          <div className="absolute inset-0 blueprint-grid opacity-10 pointer-events-none"></div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="mb-20">
              <div className="flex items-center space-x-3 mb-4">
                <span className="w-1.5 h-[1.5px] bg-blue-600"></span>
                <p className="text-[11px] font-black text-slate-400 tracking-[0.3em] uppercase">Full Lifecycle Support</p>
              </div>
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <h2 className="text-5xl font-black text-slate-900 tracking-tighter">Boutique Engineering Services.</h2>
                <div className="h-[1px] flex-grow mx-8 bg-slate-300 hidden md:block mb-4"></div>
                <a href="#contact" className="text-blue-600 font-bold uppercase tracking-widest text-xs flex items-center group">
                  Get Started <span className="ml-2 group-hover:translate-x-1 transition-transform">→</span>
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-200 border border-slate-200 shadow-xl">
              {SERVICES.map((service) => (
                <ServiceCard key={service.id} service={service} />
              ))}
            </div>
          </div>
        </section>

        <Expertise />

        <ContactForm />
      </main>

      <footer className="bg-slate-950 text-white py-24 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
        <div className="absolute bottom-0 right-0 w-1/4 h-full blueprint-grid-dark opacity-10 pointer-events-none"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 border-b border-white/5 pb-20 mb-20">
            <div>
              <Logo light={true} />
              <p className="text-slate-500 mt-6 max-w-sm font-light leading-relaxed">
                OpsBridge Engineering provides executive-level operational guidance and NPI services for the technology sector. Specialized in complex hardware transition to mass production.
              </p>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-10">
              <div className="space-y-4">
                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Navigation</p>
                <ul className="space-y-2 text-sm font-medium">
                  <li><a href="#services" className="hover:text-blue-500 transition-colors">Services</a></li>
                  <li><a href="#about" className="hover:text-blue-500 transition-colors">About</a></li>
                  <li><a href="#expertise" className="hover:text-blue-500 transition-colors">Expertise</a></li>
                </ul>
              </div>
              <div className="space-y-4">
                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Expertise</p>
                <ul className="space-y-2 text-sm font-medium text-slate-400">
                  <li>Startup Scale-up</li>
                  <li>ISO 13485 Medical</li>
                  <li>NPI Leadership</li>
                </ul>
              </div>
              <div className="space-y-4">
                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Connect</p>
                <ul className="space-y-2 text-sm font-medium">
                  <li><a href="#contact" className="hover:text-blue-500 transition-colors">Contact Me</a></li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between items-center text-slate-600 text-[10px] font-bold uppercase tracking-[0.1em]">
            <p>© {new Date().getFullYear()} OpsBridge Engineering | Eran Hakun. All Rights Reserved.</p>
            <div className="mt-4 md:mt-0 flex space-x-6">
              <span>Technion Graduate (M.E.)</span>
              <span>Global Ops Engineering</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
