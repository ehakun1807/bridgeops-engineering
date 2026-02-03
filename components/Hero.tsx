import React from 'react';
import { ArrowRight } from 'lucide-react';

const Hero: React.FC = () => {
  return (
    <div className="relative min-h-screen flex items-center overflow-hidden bg-slate-950">
      {/* High-Tech Luxury Background Layers */}
      <div className="absolute inset-0 z-0">
        {/* Animated Glow Blobs */}
        <div className="glow-blob w-[500px] h-[500px] bg-blue-600 top-[-10%] left-[-5%]"></div>
        <div className="glow-blob w-[600px] h-[600px] bg-indigo-900 bottom-[-20%] right-[-10%] animation-delay-2000"></div>
        
        {/* Refined Grid Overlay */}
        <div className="absolute inset-0 blueprint-grid-dark opacity-30"></div>
        
        {/* Gradient Fade */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/20 via-slate-950/60 to-slate-950"></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32">
        <div className="max-w-4xl">
          <div className="flex items-center space-x-3 mb-8">
            <div className="h-[2px] w-12 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]"></div>
            <span className="text-blue-400 text-xs font-black uppercase tracking-[0.4em] drop-shadow-sm">OpsBridge Engineering</span>
          </div>
          
          <h1 className="text-6xl md:text-8xl font-black text-white leading-[0.95] mb-8 tracking-tighter">
            Precision <br/><span className="text-blue-500 drop-shadow-[0_0_15px_rgba(59,130,246,0.3)]">Engineering</span> <br/>Operations.
          </h1>
          
          <p className="text-xl md:text-2xl text-slate-200 mb-12 leading-relaxed max-w-3xl font-medium border-l-4 border-blue-600 pl-6 py-2">
            We turn complex, multidisciplinary products into <span className="text-blue-400 font-bold underline decoration-blue-500/50">scalable, manufacturable operations.</span>
          </p>
          
          <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-6">
            <a 
              href="#services" 
              className="w-full sm:w-auto bg-blue-600 text-white px-10 py-5 rounded-sm font-bold text-lg hover:bg-blue-700 transition-all flex items-center justify-center group uppercase tracking-widest shadow-[0_0_30px_rgba(37,99,235,0.4)] hover:shadow-blue-500/50"
            >
              Analyze Services
              <ArrowRight className="ml-3 group-hover:translate-x-1 transition-transform" size={20} />
            </a>
            <a 
              href="#contact" 
              className="w-full sm:w-auto bg-white/5 backdrop-blur-md text-white border border-white/10 px-8 py-5 rounded-sm font-bold text-lg hover:bg-white/10 transition-all flex items-center justify-center uppercase tracking-widest"
            >
              Consultation
            </a>
          </div>
        </div>
      </div>
      
      {/* Decorative vertical line */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[1px] h-24 bg-gradient-to-b from-blue-500/50 to-transparent"></div>
    </div>
  );
};

export default Hero;