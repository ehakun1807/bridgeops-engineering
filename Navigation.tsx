
import React, { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import Logo from './Logo.tsx';

interface NavigationProps {
  currentView: string;
  onNavigate: (view: any) => void;
}

const Navigation: React.FC<NavigationProps> = ({ currentView, onNavigate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'Home', id: 'home' },
    { name: 'Services', id: 'services' },
    { name: 'Ramp Score', id: 'ramp_score' },
    { name: 'Methodology', id: 'methodology' },
    { name: 'About', id: 'about' },
    { name: 'Contact', id: 'contact' },
  ];

  const handleLinkClick = (id: string) => {
    onNavigate(id);
    setIsOpen(false);
  };

  const isAlwaysDark = currentView !== 'home';
  const navBackground = (scrolled || isAlwaysDark) 
    ? 'bg-slate-950/98 backdrop-blur-md shadow-2xl py-3 border-b border-white/10' 
    : 'bg-transparent py-6';

  return (
    <nav className={`fixed w-full z-50 transition-all duration-500 ${navBackground}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center">
          <button 
            onClick={() => handleLinkClick('home')} 
            className="flex items-center group transition-transform hover:scale-[1.02]"
          >
            <Logo 
              scrolled={scrolled || isAlwaysDark} 
              light={true} 
              isDarkMenu={true} 
              isHighlighted={isAlwaysDark} 
            />
          </button>
          
          <div className="hidden md:block">
            <div className="ml-10 flex items-center space-x-10">
              {navLinks.map((link) => (
                <button
                  key={link.id}
                  onClick={() => handleLinkClick(link.id)}
                  className={`text-[11px] font-black uppercase tracking-[0.2em] transition-all relative py-1 ${
                    currentView === link.id 
                      ? 'text-blue-400' 
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {link.name}
                  {currentView === link.id && (
                    <span className="absolute -bottom-1 left-0 w-full h-[2px] bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.8)]"></span>
                  )}
                </button>
              ))}
              
              <div className="h-4 w-[1px] bg-white/20"></div>

              <button
                onClick={() => handleLinkClick('contact')}
                className="bg-blue-600 text-white px-6 py-3 rounded-none text-[10px] font-black hover:bg-blue-500 transition-all shadow-xl hover:shadow-blue-500/40 uppercase tracking-[0.2em] border border-blue-400/30"
              >
                Let's Talk
              </button>
            </div>
          </div>

          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="text-white p-2 hover:bg-white/10 transition-colors"
            >
              {isOpen ? <X size={28} /> : <Menu size={28} />}
            </button>
          </div>
        </div>
      </div>

      {isOpen && (
        <div className="md:hidden bg-slate-950 border-b border-white/10 shadow-2xl">
          <div className="px-4 pt-4 pb-10 space-y-2">
            {navLinks.map((link) => (
              <button
                key={link.id}
                onClick={() => handleLinkClick(link.id)}
                className={`block w-full text-left px-4 py-6 text-xl font-black uppercase tracking-[0.3em] border-b border-white/5 transition-colors ${
                  currentView === link.id ? 'text-blue-400 bg-white/5' : 'text-slate-200 hover:text-white'
                }`}
              >
                {link.name}
              </button>
            ))}
            <div className="pt-6 px-4">
              <button
                onClick={() => handleLinkClick('contact')}
                className="w-full text-center bg-blue-600 text-white py-5 font-black uppercase tracking-[0.2em] text-sm shadow-2xl"
              >
                Request Consultation
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navigation;
