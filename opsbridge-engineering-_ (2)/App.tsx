import React, { useState, useEffect } from 'react';
import Navigation from './components/Navigation';
import Hero from './components/Hero';
import ServiceCard from './components/ServiceCard';
import Expertise from './components/Expertise';
import ContactForm from './components/ContactForm';
import MethodologyLayers from './components/MethodologyLayers.tsx';
import Logo from './components/Logo';
import { SERVICES } from './constants';
import { Hammer, ArrowRight, Activity, ShieldCheck, Zap, HardHat, Cpu, Rocket, Settings2 } from 'lucide-react';

type View = 'home' | 'services' | 'methodology' | 'about' | 'contact';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('home');

  // Scroll to top on view change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentView]);

  const navigateTo = (view: View) => {
    setCurrentView(view);
  };

  const renderView = () => {
    switch (currentView) {
      case 'home':
        return (
          <>
            <Hero onNavigate={navigateTo} />
            
            {/* Market Focus Ticker / Section */}
            <div className="bg-white py-10 border-b border-slate-100">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-wrap items-center justify-center gap-x-16 gap-y-6 opacity-40 grayscale">
                   <div className="flex items-center space-x-2">
                     <Rocket size={18} />
                     <span className="font-black uppercase tracking-widest text-[9px]">Hardware & Electro-Mechanical Startups</span>
                   </div>
                   <div className="flex items-center space-x-2">
                     <ShieldCheck size={18} />
                     <span className="font-black uppercase tracking-widest text-[9px]">Medical & Regulated Devices</span>
                   </div>
                   <div className="flex items-center space-x-2">
                     <Settings2 size={18} />
                     <span className="font-black uppercase tracking-widest text-[9px]">Robotics & Industrial Systems</span>
                   </div>
                </div>
              </div>
            </div>

            {/* Core USP Banner */}
            <div className="bg-slate-900 py-14 border-y border-white/5 relative overflow-hidden">
              <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                   <div>
                      <h3 className="text-white text-2xl md:text-4xl font-black tracking-tighter leading-tight uppercase">
                        From Lab to <br/><span className="text-blue-500 italic">Production Floor.</span>
                      </h3>
                      <p className="text-slate-400 mt-4 text-base font-medium max-w-lg leading-relaxed">
                        We don't provide theories. We provide fractional leadership and engineering execution to ensure your hardware is manufactured at scale, on time, and within budget.
                      </p>
                   </div>
                   <div className="flex justify-start lg:justify-end">
                      <button 
                        onClick={() => navigateTo('methodology')}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 font-black uppercase tracking-[0.2em] text-xs transition-all shadow-xl shadow-blue-500/20 flex items-center group"
                      >
                        See how we work <ArrowRight size={16} className="ml-4 group-hover:translate-x-1 transition-transform" />
                      </button>
                   </div>
                </div>
              </div>
            </div>

            <section className="py-20 bg-slate-50">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-8">
                  <div>
                    <div className="flex items-center space-x-2 mb-4">
                      <div className="w-10 h-[1px] bg-blue-600"></div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">Expertise Domains</span>
                    </div>
                    <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase">Solutions Suite.</h2>
                  </div>
                  <button 
                    onClick={() => navigateTo('services')}
                    className="bg-white border-2 border-slate-900 px-6 py-2.5 text-slate-900 font-black uppercase tracking-widest text-[10px] hover:bg-slate-900 hover:text-white transition-all"
                  >
                    All Services
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-slate-200 border border-slate-200 shadow-2xl">
                  {SERVICES.slice(0, 3).map((service) => (
                    <ServiceCard key={service.id} service={service} />
                  ))}
                </div>
              </div>
            </section>
          </>
        );

      case 'services':
        return (
          <div className="pt-24 min-h-screen bg-slate-50">
            <div className="bg-slate-900 py-24 text-center relative overflow-hidden">
              <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
              <div className="relative z-10 max-w-4xl mx-auto px-4">
                <span className="text-blue-500 font-black uppercase tracking-[0.4em] text-[10px] mb-6 block">Capabilities</span>
                <h1 className="text-5xl md:text-7xl font-black text-white tracking-tighter uppercase leading-[0.85]">Engineering <br/><span className="text-blue-600">Services</span></h1>
                <p className="text-slate-400 mt-8 text-lg font-medium max-w-2xl mx-auto leading-relaxed">Comprehensive operational infrastructure designed to bridge the gap from concept to sustained mass production.</p>
              </div>
            </div>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-200 border border-slate-200 shadow-2xl">
                {SERVICES.map((service) => (
                  <ServiceCard key={service.id} service={service} />
                ))}
              </div>
            </div>
          </div>
        );

      case 'methodology':
        return (
          <div className="pt-24 min-h-screen">
             <MethodologyLayers />
          </div>
        );

      case 'about':
        return (
          <div className="pt-24 min-h-screen bg-white">
            <Expertise />
            <section className="py-20 bg-slate-900 text-white relative overflow-hidden">
               <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-16 text-center">
                  <div className="space-y-4">
                    <div className="text-5xl font-black text-blue-500 tracking-tighter">20+</div>
                    <p className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Years of Cross-Sector Experience</p>
                  </div>
                  <div className="space-y-4">
                    <div className="text-5xl font-black text-blue-500 tracking-tighter">Global</div>
                    <p className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Operational Scale & Reach</p>
                  </div>
                  <div className="space-y-4">
                    <div className="text-5xl font-black text-blue-500 tracking-tighter">M.E.</div>
                    <p className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Technion Master of Engineering</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        );

      case 'contact':
        return (
          <div className="pt-24 min-h-screen bg-slate-50">
            <ContactForm />
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfcfd]">
      <Navigation currentView={currentView} onNavigate={navigateTo} />
      
      <main>
        {renderView()}
      </main>

      <footer className="bg-slate-950 text-white py-20 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
        <div className="absolute bottom-0 right-0 w-1/4 h-full blueprint-grid-dark opacity-10 pointer-events-none"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 border-b border-white/5 pb-16 mb-16">
            <div>
              <button onClick={() => navigateTo('home')} className="block mb-8">
                <Logo light={true} />
              </button>
              <p className="text-slate-500 max-w-sm font-medium leading-relaxed text-sm">
                OpsBridge Engineering provides executive-level operational guidance and NPI services for the technology sector. Specialized in complex hardware transition to mass production.
              </p>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-12">
              <div className="space-y-6">
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.3em]">Navigation</p>
                <ul className="space-y-3 text-xs font-bold uppercase tracking-tight">
                  <li><button onClick={() => navigateTo('services')} className="hover:text-blue-500 transition-colors">Services</button></li>
                  <li><button onClick={() => navigateTo('methodology')} className="hover:text-blue-500 transition-colors">Methodology</button></li>
                  <li><button onClick={() => navigateTo('about')} className="hover:text-blue-500 transition-colors">Background</button></li>
                  <li><button onClick={() => navigateTo('contact')} className="hover:text-blue-500 transition-colors">Contact</button></li>
                </ul>
              </div>
              <div className="space-y-6">
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.3em]">Verticals</p>
                <ul className="space-y-3 text-xs font-bold text-slate-400 uppercase tracking-tight">
                  <li>Hardware & Electro-Mechanical Startups</li>
                  <li>Medical & Regulated Devices</li>
                  <li>Robotics & Industrial Systems</li>
                </ul>
              </div>
              <div className="space-y-6">
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.3em]">Consultancy</p>
                <ul className="space-y-3 text-xs font-bold uppercase tracking-tight">
                  <li><button onClick={() => navigateTo('contact')} className="text-blue-500 hover:text-blue-400 transition-colors underline decoration-2 underline-offset-4">Audit Request</button></li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between items-center text-slate-600 text-[9px] font-black uppercase tracking-[0.2em]">
            <p>© {new Date().getFullYear()} OpsBridge Engineering | Eran Hakun. All Rights Reserved.</p>
            <div className="mt-6 md:mt-0 flex space-x-8">
              <span className="flex items-center"><div className="w-1.5 h-1.5 bg-blue-500 mr-2"></div> Technion Graduate (M.E.)</span>
              <span className="flex items-center"><div className="w-1.5 h-1.5 bg-blue-500 mr-2"></div> Global Operations</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;