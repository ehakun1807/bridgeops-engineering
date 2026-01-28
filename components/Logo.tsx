
import React from 'react';
import { Share2 } from 'lucide-react';

interface LogoProps {
  scrolled?: boolean;
  light?: boolean;
}

const Logo: React.FC<LogoProps> = ({ scrolled, light }) => {
  return (
    <div className="flex items-center space-x-2 group">
      <div className={`relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-300 ${scrolled || !light ? 'bg-blue-600 rotate-0' : 'bg-white/10 backdrop-blur-md rotate-45 group-hover:rotate-0'}`}>
        <Share2 className={`w-6 h-6 transition-colors ${scrolled || !light ? 'text-white' : 'text-blue-400'}`} />
      </div>
      <div className="flex flex-col leading-none">
        <span className={`text-xl font-extrabold tracking-tight transition-colors ${scrolled || !light ? 'text-slate-900' : 'text-white'}`}>
          OpsBridge<span className="text-blue-500">.</span>
        </span>
        <span className={`text-[10px] font-bold uppercase tracking-[0.2em] transition-colors ${scrolled || !light ? 'text-slate-500' : 'text-slate-400'}`}>
          Engineering
        </span>
      </div>
    </div>
  );
};

export default Logo;
