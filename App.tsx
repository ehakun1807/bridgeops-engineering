import React, { useState, useEffect } from 'react';
import Navigation from './components/Navigation';
import Hero from './components/Hero';
import ServiceCard from './components/ServiceCard';
import Expertise from './components/Expertise';
import ContactForm from './components/ContactForm';
import MethodologyLayers from './components/MethodologyLayers.tsx';
import Logo from './components/Logo';
import { SERVICES } from './constants';
import { Hammer, ArrowRight } from 'lucide-react';

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
            <Hero />
            {/* Mission Statement Banner */}
            <div className="bg-slate-900 py-12 border-y border-white/10 relative overflow-hidden">
              <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                  <div className="flex items-center gap-6">
                    <div className="bg-blue-600 p-4 rounded-full shadow-[0_0_20px_rgba(37,99,235,0.4)]">
                      <Hammer className="text-white" size={32} />
                    </div>
                    <div>
                      <h3 className="text-white text-2xl md:text-3xl font-black tracking-tight leading-tight">
                        From early development to <span className="text-blue-500">stable mass production</span>
                      </h3>
                      <p className="text-blue-400 font-bold uppercase tracking-[0.2em] text-xs mt-1 italic">
                        — with hands-on execution, not just advice.
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => navigateTo('methodology')}
                    className="bg-white/5 hover:bg-white/10 text-white px-6 py-3 border border-white/10 font-bold uppercase tracking-widest text-xs transition-all flex items-center group"
                  >
                    Our Methodology <ArrowRight size={14} className="ml-2 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            </div>

            <section className="py-24 bg-white">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
                  <div>
                    <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Our Core Capabilities.</h2>
                    <p className="text-slate-500 mt-2 font-medium">Boutique engineering services for high-tech scalability.</p>
                  </div>
                  <button 
                    onClick={() => navigateTo('services')}
                    className="text-blue-600 font-bold uppercase tracking-widest text-xs flex items-center group"
                  >
                    View All Services <ArrowRight size={16} className="ml-2 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-slate-200 border border-slate-200">
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
              <h1 className="text-5xl md:text-7xl font-black text-white relative z-10 tracking-tighter">Engineering <span className="text-blue-500">Services</span></h1>
              <p className="text-slate-400 mt-4 text-xl relative z-10 max-w-2xl mx-auto">Comprehensive operational infrastructure from concept to sustained mass production.</p>
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
            <section className="py-20 bg-slate-900 text-white">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center">
                  <div>
                    <div className="text-4xl font-black text-blue-500 mb-2">15+</div>
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Years of Experience</p>
                  </div>
                  <div>
                    <div className="text-4xl font-black text-blue-500 mb-2">Global</div>
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Operations Expert</p>
                  </div>
                  <div>
                    <div className="text-4xl font-black text-blue-500 mb-2">M.E.</div>
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Technion Graduate</p>
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

      <footer className="bg-slate-950 text-white py-24 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
        <div className="absolute bottom-0 right-0 w-1/4 h-full blueprint-grid-dark opacity-10 pointer-events-none"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 border-b border-white/5 pb-20 mb-20">
            <div>
              <button onClick={() => navigateTo('home')} className="block">
                <Logo light={true} />
              </button>
              <p className="text-slate-500 mt-6 max-w-sm font-light leading-relaxed">
                OpsBridge Engineering provides executive-level operational guidance and NPI services for the technology sector. Specialized in complex hardware transition to mass production.
              </p>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-10">
              <div className="space-y-4">
                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Navigation</p>
                <ul className="space-y-2 text-sm font-medium">
                  <li><button onClick={() => navigateTo('services')} className="hover:text-blue-500 transition-colors">Services</button></li>
                  <li><button onClick={() => navigateTo('methodology')} className="hover:text-blue-500 transition-colors">Methodology</button></li>
                  <li><button onClick={() => navigateTo('about')} className="hover:text-blue-500 transition-colors">About</button></li>
                  <li><button onClick={() => navigateTo('contact')} className="hover:text-blue-500 transition-colors">Contact</button></li>
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
                  <li><button onClick={() => navigateTo('contact')} className="hover:text-blue-500 transition-colors">Request Consultation</button></li>
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