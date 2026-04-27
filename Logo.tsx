
import React from 'react';
import { Share2 } from 'lucide-react';

interface LogoProps {
  scrolled?: boolean;
  light?: boolean;
  isDarkMenu?: boolean; 
  isHighlighted?: boolean;
}

const Logo: React.FC<LogoProps> = ({ scrolled, light, isDarkMenu, isHighlighted }) => {
  const useLightText = light || isDarkMenu;
  
  return (
    <div className="flex items-center space-x-3 group">
      <div className={`relative flex items-center justify-center w-11 h-11 rounded-none transition-all duration-500 shadow-lg ${scrolled || !light ? 'bg-blue-600 rotate-0' : 'bg-white/10 backdrop-blur-md rotate-45 group-hover:rotate-0 border border-white/20'}`}>
        <Share2 className={`w-6 h-6 transition-colors ${scrolled || !light ? 'text-white' : 'text-blue-400'}`} />
        <div className="absolute inset-0 border border-white/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
      </div>
      <div className="flex flex-col leading-none text-left">
        <span className={`text-2xl font-black tracking-tighter transition-all duration-300 ${isHighlighted ? 'text-blue-500 drop-shadow-[0_0_8px_rgba(59,130,246,0.4)]' : (useLightText ? 'text-white' : 'text-slate-900')}`}>
          BridgeOps<span className={isHighlighted ? 'text-white' : 'text-blue-500'}>.</span>
        </span>
        <span className={`text-[10px] font-black uppercase tracking-[0.3em] transition-colors ${isHighlighted ? 'text-blue-300/60' : (useLightText ? 'text-slate-400' : 'text-slate-500')}`}>
          ENGINEERING
        </span>
      </div>
    </div>
  );
};

export default Logo;
