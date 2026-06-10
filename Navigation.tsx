
import React, { useState, useEffect } from 'react';
import { Menu, X, LogOut, User as UserIcon } from 'lucide-react';
import Logo from './Logo.tsx';
import { auth } from './firebase.ts';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import AuthModal from './AuthModal.tsx';
import type { View, NavigateFn } from './types';
import { isAdminUser } from './config.ts';

interface NavigationProps {
  currentView: View;
  onNavigate: NavigateFn;
}

const Navigation: React.FC<NavigationProps> = ({ currentView, onNavigate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
    });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      onNavigate('home');
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  const navLinks: Array<{ name: string; id: View; isNew?: boolean }> = [
    { name: 'Methodology', id: 'methodology' },
    { name: 'Ramp Score', id: 'ramp_score' },
    { name: 'Intelligence', id: 'intelligence', isNew: true },
    { name: 'Engagements', id: 'pricing' },
    { name: 'About', id: 'about' },
  ];

  const handleLinkClick = (id: View) => {
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
                  className={`text-[11px] font-black uppercase tracking-[0.2em] transition-all relative py-1 flex items-center gap-1.5 ${
                    currentView === link.id
                      ? 'text-blue-400'
                      : link.isNew
                      ? 'text-white hover:text-blue-300'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {link.name}
                  {link.isNew && currentView !== link.id && (
                    <span className="text-[8px] font-black tracking-widest bg-blue-600/30 text-blue-400 border border-blue-500/40 px-1.5 py-0.5 rounded-sm">
                      NEW
                    </span>
                  )}
                  {currentView === link.id && (
                    <span className="absolute -bottom-1 left-0 w-full h-[2px] bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.8)]"></span>
                  )}
                </button>
              ))}
              
              <div className="h-4 w-[1px] bg-white/20"></div>

              <button
                onClick={() => handleLinkClick('contact')}
                aria-label="Contact us"
                className={`text-[11px] font-black uppercase tracking-[0.2em] transition-all relative py-1 ${
                  currentView === 'contact' ? 'text-blue-400' : 'text-slate-300 hover:text-white'
                }`}
              >
                Contact
                {currentView === 'contact' && (
                  <span className="absolute -bottom-1 left-0 w-full h-[2px] bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.8)]"></span>
                )}
              </button>

              {user ? (
                isAdminUser(user.email) ? (
                  <div className="flex items-center space-x-4">
                    <button
                      onClick={() => handleLinkClick('dashboard')}
                      aria-label="Open BridgeOps Intelligence platform"
                      className="bg-blue-600 text-white px-6 py-3 border border-blue-400/30 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-blue-500 transition-all shadow-xl shadow-blue-500/20 flex items-center space-x-2"
                    >
                      <UserIcon size={14} />
                      <span>Intelligence</span>
                    </button>
                    <div className="flex items-center gap-1 border border-blue-500/30 bg-blue-500/10 px-2 py-1 rounded-sm pointer-events-none">
                      <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse flex-shrink-0"></div>
                      <span className="text-[8px] font-black uppercase tracking-widest text-blue-400">Live</span>
                    </div>
                    <button
                      onClick={handleSignOut}
                      aria-label="Sign out"
                      className="text-slate-500 hover:text-white transition-colors"
                    >
                      <LogOut size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center space-x-4">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Private Beta
                    </span>
                    <button
                      onClick={handleSignOut}
                      aria-label="Sign out"
                      className="text-slate-500 hover:text-white transition-colors"
                    >
                      <LogOut size={16} />
                    </button>
                  </div>
                )
              ) : (
                <button
                  onClick={() => setShowAuth(true)}
                  aria-label="Sign in"
                  className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 hover:text-white transition-colors py-1"
                >
                  Sign In
                </button>
              )}
            </div>
          </div>

          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsOpen(!isOpen)}
              aria-label={isOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isOpen}
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
            {[...navLinks, { name: 'Contact', id: 'contact' as View }].map((link) => (
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
              {user ? (
                isAdminUser(user.email) ? (
                  <div className="space-y-4">
                    <button
                      onClick={() => handleLinkClick('dashboard')}
                      className="w-full text-center bg-blue-600 text-white py-5 font-black uppercase tracking-[0.2em] text-sm shadow-2xl shadow-blue-500/30"
                    >
                      Intelligence
                    </button>
                    <button
                      onClick={handleSignOut}
                      className="w-full text-center bg-white/5 text-slate-400 py-5 font-black uppercase tracking-[0.2em] text-sm border border-white/5"
                    >
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="w-full text-center text-slate-500 py-4 font-black uppercase tracking-[0.2em] text-xs border border-white/10">
                      Private Beta — Access Pending
                    </div>
                    <button
                      onClick={handleSignOut}
                      className="w-full text-center bg-white/5 text-slate-400 py-5 font-black uppercase tracking-[0.2em] text-sm border border-white/5"
                    >
                      Sign Out
                    </button>
                  </div>
                )
              ) : (
                <button
                  onClick={() => { setShowAuth(true); setIsOpen(false); }}
                  className="w-full text-center text-slate-400 hover:text-white py-4 font-black uppercase tracking-[0.2em] text-xs border border-white/10"
                >
                  Sign In
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <AuthModal 
        isOpen={showAuth} 
        onClose={() => setShowAuth(false)} 
        onSuccess={() => onNavigate('pricing')} 
      />
    </nav>
  );
};

export default Navigation;
