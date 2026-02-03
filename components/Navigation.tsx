import React, { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import Logo from './Logo';

interface NavigationProps {
  currentView: string;
  onNavigate: (view: any) => void;
}

const Navigation: React.FC<NavigationProps> = ({ currentView, onNavigate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'Home', id: 'home' },
    { name: 'Services', id: 'services' },
    { name: 'Methodology', id: 'methodology' },
    { name: 'About', id: 'about' },
    { name: 'Contact', id: 'contact' },
  ];

  const handleLinkClick = (id: string) => {
    onNavigate(id);
    setIsOpen(false);
  };

  return (
    <nav className={`fixed w-full z-50 transition-all duration-300 ${scrolled ? 'bg-white shadow-md py-3' : 'bg-transparent py-5'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center">
          <button onClick={() => handleLinkClick('home')} className="flex items-center">
            <Logo scrolled={scrolled} light={true} />
          </button>
          
          <div className="hidden md:block">
            <div className="ml-10 flex items-center space-x-8">
              {navLinks.map((link) => (
                <button
                  key={link.id}
                  onClick={() => handleLinkClick(link.id)}
                  className={`text-sm font-semibold transition-all relative py-1 ${
                    currentView === link.id 
                      ? (scrolled ? 'text-blue-600' : 'text-white') 
                      : (scrolled ? 'text-slate-600 hover:text-blue-600' : 'text-slate-200 hover:text-white')
                  }`}
                >
                  {link.name}
                  {currentView === link.id && (
                    <span className={`absolute bottom-0 left-0 w-full h-[2px] ${scrolled ? 'bg-blue-600' : 'bg-blue-400'}`}></span>
                  )}
                </button>
              ))}
              
              <div className="h-4 w-[1px] bg-slate-400/30"></div>

              <button
                onClick={() => handleLinkClick('contact')}
                className="bg-blue-600 text-white px-5 py-2.5 rounded-sm text-sm font-bold hover:bg-blue-700 transition-all shadow-lg hover:shadow-blue-200 uppercase tracking-widest"
              >
                Let's Talk
              </button>
            </div>
          </div>

          <div className="md:hidden flex items-center space-x-4">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className={`${scrolled ? 'text-slate-900' : 'text-white'} p-2`}
            >
              {isOpen ? <X size={28} /> : <Menu size={28} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden bg-white border-b border-slate-100 shadow-2xl animate-in slide-in-from-top duration-300">
          <div className="px-4 pt-2 pb-6 space-y-1">
            {navLinks.map((link) => (
              <button
                key={link.id}
                onClick={() => handleLinkClick(link.id)}
                className={`block w-full text-left px-3 py-5 text-lg font-black uppercase tracking-widest border-b border-slate-50 transition-colors ${
                  currentView === link.id ? 'text-blue-600 bg-blue-50/50' : 'text-slate-700 hover:text-blue-600'
                }`}
              >
                {link.name}
              </button>
            ))}
            <button
              onClick={() => handleLinkClick('contact')}
              className="mt-4 block w-full text-center bg-blue-600 text-white px-5 py-4 rounded-sm text-base font-black uppercase tracking-widest"
            >
              Request Consultation
            </button>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navigation;