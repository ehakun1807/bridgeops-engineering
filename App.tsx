
import React, { useState, useEffect, lazy, Suspense } from 'react';
import Navigation from './Navigation.tsx';
import Hero from './Hero.tsx';
import ServiceCard from './ServiceCard.tsx';
import Expertise from './Expertise.tsx';
import ContactForm from './ContactForm.tsx';
import MethodologyLayers from './MethodologyLayers.tsx';
import Logo from './Logo.tsx';
import Pricing from './Pricing.tsx';
import { SERVICES } from './constants.tsx';
import { ArrowRight, ShieldCheck, Rocket, Settings2, Linkedin, Mail, Lock } from 'lucide-react';
import type { View, NavigateFn } from './types';
import { auth } from './firebase.ts';
import { onAuthStateChanged, User } from 'firebase/auth';
import { isAdminUser } from './config.ts';

// Heavier views — load on demand to keep the home-page bundle lean.
const RampScoreTool = lazy(() => import('./RampScoreTool.tsx'));
const Dashboard = lazy(() => import('./Dashboard.tsx'));
const IntelligencePage = lazy(() => import('./IntelligencePage.tsx'));
const SupplierTrackerPage = lazy(() => import('./SupplierTrackerPage.tsx'));

// URL <-> view mapping. Hash routing keeps things simple and works on any static host.
const VIEW_TO_PATH: Record<View, string> = {
  home: '/',
  services: '/services',
  methodology: '/methodology',
  about: '/about',
  contact: '/contact',
  ramp_score: '/ramp-score',
  pricing: '/pricing',
  dashboard: '/dashboard',
  intelligence: '/intelligence',
  suppliers: '/suppliers',
};

const PATH_TO_VIEW: Record<string, View> = Object.fromEntries(
  Object.entries(VIEW_TO_PATH).map(([view, path]) => [path, view as View])
) as Record<string, View>;

const VIEW_TITLES: Record<View, string> = {
  home: 'BridgeOps.ENGINEERING | Eran Hakun | NPI & Operations Engineering',
  services: 'Services | BridgeOps.ENGINEERING',
  methodology: 'Methodology | BridgeOps.ENGINEERING',
  about: 'About Eran Hakun | BridgeOps.ENGINEERING',
  contact: 'Contact | BridgeOps.ENGINEERING',
  ramp_score: 'Ramp Readiness Score | BridgeOps.ENGINEERING',
  pricing: 'Engagements | BridgeOps.ENGINEERING',
  dashboard: 'Dashboard | BridgeOps.ENGINEERING',
  intelligence: 'BridgeOps Intelligence | Operational AI Platform',
  suppliers: 'Supplier Tracker | BridgeOps Intelligence',
};

function getViewFromHash(): View {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  return PATH_TO_VIEW[raw] ?? 'home';
}

function useHashRoute(): [View, NavigateFn] {
  const [view, setView] = useState<View>(typeof window !== 'undefined' ? getViewFromHash() : 'home');

  useEffect(() => {
    // Scroll to top on initial mount (covers deep-link landing like /#/pricing).
    window.scrollTo(0, 0);

    const onChange = () => {
      setView(getViewFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  // Keep <title> in sync so browser tabs and shared links look right.
  useEffect(() => {
    document.title = VIEW_TITLES[view] ?? VIEW_TITLES.home;
  }, [view]);

  const navigate: NavigateFn = (next) => {
    const path = VIEW_TO_PATH[next];
    const target = `#${path}`;
    if (window.location.hash === target) {
      // Already on this view — re-trigger and scroll up.
      window.scrollTo(0, 0);
      setView(next);
    } else {
      window.location.hash = path;
      // The hashchange listener will scroll to top.
    }
  };

  return [view, navigate];
}

const ViewLoader: React.FC = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="flex flex-col items-center space-y-4">
      <div className="w-12 h-12 border-2 border-slate-200 border-t-blue-600 rounded-full animate-spin" aria-hidden="true"></div>
      <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Loading</span>
    </div>
  </div>
);

const App: React.FC = () => {
  const [currentView, navigateTo] = useHashRoute();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [contactSource, setContactSource] = useState<'intelligence' | undefined>(undefined);
  const linkedInUrl = "https://www.linkedin.com/in/eran-hakun-81a80a1b";

  const navigateToContact = (source?: 'intelligence') => {
    setContactSource(source);
    navigateTo('contact');
  };

  // Reset contact source whenever the user navigates away from the contact page
  useEffect(() => {
    if (currentView !== 'contact') setContactSource(undefined);
  }, [currentView]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const renderView = () => {
    switch (currentView) {
      case 'home':
        return (
          <>
            <Hero onNavigate={navigateTo} />

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

            <div className="bg-slate-900 py-14 border-y border-white/5 relative overflow-hidden text-left">
              <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                   <div className="text-left">
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
                        aria-label="See how we work — view our methodology"
                        className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 font-black uppercase tracking-[0.2em] text-xs transition-all shadow-xl shadow-blue-500/20 flex items-center group"
                      >
                        See how we work <ArrowRight size={16} className="ml-4 group-hover:translate-x-1 transition-transform" />
                      </button>
                   </div>
                </div>
              </div>
            </div>

            {/* BridgeOps Intelligence strip */}
            <div className="bg-slate-950 border-y border-white/5 relative overflow-hidden">
              <div className="absolute inset-0 blueprint-grid-dark opacity-10 pointer-events-none"></div>
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative z-10">
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
                  <div className="flex-1 max-w-2xl">
                    <p className="text-blue-400 text-[10px] font-black uppercase tracking-[0.35em] mb-3">BridgeOps Intelligence</p>
                    <h2 className="text-white text-2xl md:text-3xl font-black tracking-tighter leading-tight uppercase mb-3">
                      Every engagement runs on<br className="hidden md:block" /> proprietary tooling built in-house.
                    </h2>
                    <p className="text-slate-400 text-sm font-medium leading-relaxed mb-5 max-w-xl">
                      Not spreadsheets. Not off-the-shelf PM tools. A purpose-built intelligence platform that connects RAMP scoring, risk data, BOM changes, and decisions — live, across your entire project.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {['PFMEA', 'ECO Pulse', 'Decision Ledger', 'Takt analysis', 'AI cross-tool scan', 'Process Map', 'Doc Guard', 'SOP Radar'].map((tag) => (
                        <span key={tag} className="text-[11px] text-slate-500 border border-slate-800 rounded-full px-3 py-1 bg-white/[0.02] font-medium">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => navigateTo('intelligence')}
                    aria-label="See what's inside BridgeOps Intelligence"
                    className="flex-shrink-0 flex items-center gap-3 border border-slate-700 text-slate-300 hover:text-white hover:border-blue-500 px-6 py-3 text-[11px] font-black uppercase tracking-[0.2em] transition-all group"
                  >
                    See what&apos;s inside
                    <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            </div>

            <section className="py-20 bg-white border-b border-slate-100">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="bg-slate-900 rounded-sm p-8 md:p-16 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-12 text-left">
                   <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
                   <div className="relative z-10 text-left max-w-xl">
                      <span className="text-blue-500 font-black uppercase tracking-[0.3em] text-[10px] mb-4 block">BridgeOps Snapshot Utility</span>
                      <h2 className="text-3xl md:text-5xl font-black text-white uppercase tracking-tighter leading-none">
                        Ramp Readiness <br/><span className="text-blue-600">Snapshot.</span>
                      </h2>
                      <p className="text-slate-400 mt-6 text-base font-medium leading-relaxed">
                        Are you ready for mass production? Use our free 10-parameter diagnostic tool to instantly identify operational gaps and receive a strategic readiness audit. No login required.
                      </p>
                   </div>
                   <div className="relative z-10">
                      <button
                        onClick={() => navigateTo('ramp_score')}
                        aria-label="Launch the free Ramp Readiness Snapshot"
                        className="bg-blue-600 hover:bg-blue-700 text-white px-10 py-5 font-black uppercase tracking-[0.2em] text-xs transition-all shadow-2xl shadow-blue-500/20 flex items-center group"
                      >
                        Launch Snapshot <ArrowRight size={16} className="ml-4 group-hover:translate-x-1 transition-transform" />
                      </button>
                   </div>
                </div>
              </div>
            </section>

            <section className="py-20 bg-slate-50">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-8 text-left">
                  <div>
                    <div className="flex items-center space-x-2 mb-4">
                      <div className="w-10 h-[1px] bg-blue-600"></div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">Expertise Domains</span>
                    </div>
                    <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase">Solutions Suite.</h2>
                  </div>
                  <button
                    onClick={() => navigateTo('services')}
                    aria-label="View all services"
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
                <h1 className="text-5xl md:text-7xl font-black text-white tracking-tighter uppercase leading-[0.85]">Where I <br/><span className="text-blue-600">Go Deep</span></h1>
                <p className="text-slate-400 mt-8 text-lg font-medium max-w-2xl mx-auto leading-relaxed">Nine disciplines I've built and rebuilt across medical, defense, and industrial scale-ups. These show up inside the engagements — they don't get sold separately.</p>
              </div>
            </div>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-200 border border-slate-200 shadow-2xl">
                {SERVICES.map((service) => (
                  <ServiceCard key={service.id} service={service} />
                ))}
              </div>

              <div className="mt-24 text-center">
                <div className="inline-block p-12 bg-slate-900 rounded-none border border-slate-800 shadow-2xl relative overflow-hidden">
                  <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
                  <h3 className="text-2xl font-black text-white relative z-10 mb-4 tracking-tighter uppercase">These Are Capabilities, Not Products</h3>
                  <p className="text-slate-400 mb-8 relative z-10 font-medium text-sm max-w-xl mx-auto">The way to use them is through one of three engagement models — from a free self-service audit to embedded ramp leadership.</p>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center relative z-10">
                    <button
                      onClick={() => navigateTo('pricing')}
                      aria-label="See engagement options"
                      className="inline-flex items-center justify-center bg-blue-600 text-white px-10 py-5 font-black uppercase tracking-[0.2em] text-xs hover:bg-blue-700 transition-all"
                    >
                      See How To Work Together
                    </button>
                    <button
                      onClick={() => navigateTo('ramp_score')}
                      aria-label="Run the free Ramp Readiness Snapshot"
                      className="inline-flex items-center justify-center bg-white/5 border border-white/10 text-white px-10 py-5 font-black uppercase tracking-[0.2em] text-xs hover:bg-white/10 transition-all"
                    >
                      Run Free Snapshot
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'methodology':
        return (
          <div className="pt-24 min-h-screen">
             <MethodologyLayers onNavigate={navigateTo} />
          </div>
        );

      case 'about':
        return (
          <div className="pt-24 min-h-screen bg-white text-left">
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
            <ContactForm source={contactSource} />
          </div>
        );
      case 'ramp_score':
        return (
          <div className="pt-24 min-h-screen bg-slate-50">
            <Suspense fallback={<ViewLoader />}>
              <RampScoreTool onNavigate={navigateTo} />
            </Suspense>
          </div>
        );
      case 'pricing':
        return (
          <div className="pt-24 min-h-screen bg-slate-50">
            <Pricing
              onNavigate={navigateTo}
              onSelectPlan={(plan) => {
                console.log('Selected plan:', plan);
                navigateTo('contact');
              }}
            />
          </div>
        );
      case 'intelligence':
        return (
          <div className="pt-24 min-h-screen">
            <Suspense fallback={<ViewLoader />}>
              <IntelligencePage onNavigate={navigateTo} onRequestAccess={() => navigateToContact('intelligence')} />
            </Suspense>
          </div>
        );

      case 'suppliers': {
        if (!authReady) {
          return (
            <div className="pt-24 min-h-screen bg-slate-50">
              <ViewLoader />
            </div>
          );
        }
        if (!isAdminUser(authUser?.email)) {
          return (
            <div className="pt-24 min-h-screen bg-slate-50 flex items-center justify-center">
              <div className="text-center">
                <Lock size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-600 font-semibold">Sign in to access Supplier Tracker</p>
              </div>
            </div>
          );
        }
        return (
          <div className="pt-[64px] min-h-screen">
            <Suspense fallback={<ViewLoader />}>
              <SupplierTrackerPage />
            </Suspense>
          </div>
        );
      }

      case 'dashboard': {
        // While we're still resolving auth state, show the loader so the
        // page doesn't flash the private-beta screen for a signed-in admin.
        if (!authReady) {
          return (
            <div className="pt-24 min-h-screen bg-slate-50">
              <ViewLoader />
            </div>
          );
        }
        if (!isAdminUser(authUser?.email)) {
          return (
            <div className="pt-24 min-h-screen bg-slate-50 flex items-center justify-center px-4">
              <div className="max-w-xl w-full bg-white border border-slate-200 shadow-2xl shadow-slate-900/5 p-12 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 bg-slate-900 text-white mb-8">
                  <Lock size={22} />
                </div>
                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-600 mb-4">
                  Private Beta
                </div>
                <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight mb-5 leading-tight">
                  BridgeOps SaaS is invite-only right now.
                </h2>
                <p className="text-slate-600 text-[15px] leading-relaxed mb-10">
                  We&apos;re running a closed beta with a small set of partners while we harden the
                  platform. If you&apos;d like early access, join the waitlist from the pricing page and
                  we&apos;ll reach out as soon as a seat opens up.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button
                    onClick={() => navigateTo('pricing')}
                    className="bg-blue-600 text-white px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-blue-700 transition-colors"
                  >
                    Join the Waitlist
                  </button>
                  <button
                    onClick={() => navigateTo('home')}
                    className="bg-white text-slate-600 px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] border border-slate-200 hover:text-slate-900 hover:border-slate-400 transition-colors"
                  >
                    Back to Home
                  </button>
                </div>
              </div>
            </div>
          );
        }
        return (
          <div className="pt-24 min-h-screen bg-slate-50">
            <Suspense fallback={<ViewLoader />}>
              <Dashboard />
            </Suspense>
          </div>
        );
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfcfd]">
      <div className="no-print">
        <Navigation currentView={currentView} onNavigate={navigateTo} />
      </div>

      <main>
        {renderView()}
      </main>

      <footer className="bg-slate-950 text-white py-20 relative overflow-hidden no-print">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
        <div className="absolute bottom-0 right-0 w-1/4 h-full blueprint-grid-dark opacity-10 pointer-events-none"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 border-b border-white/5 pb-16 mb-16">
            <div className="text-left">
              <button onClick={() => navigateTo('home')} aria-label="Go to home page" className="block mb-8">
                <Logo light={true} />
              </button>
              <p className="text-slate-500 max-w-sm font-medium leading-relaxed text-sm">
                BridgeOps.ENGINEERING provides executive-level operational guidance and NPI services for the technology sector. Specialized in complex hardware transition to mass production.
              </p>
              <div className="mt-8 space-y-4">
                 <a
                  href={linkedInUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Connect with Eran Hakun on LinkedIn"
                  className="inline-flex items-center space-x-2 text-slate-400 hover:text-blue-500 transition-colors group"
                >
                  <Linkedin size={20} className="group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Connect with Eran Hakun</span>
                </a>
                <div className="block">
                  <a
                    href="mailto:eran@bridgeops-engineering.com"
                    aria-label="Email Eran Hakun"
                    className="inline-flex items-center space-x-2 text-slate-400 hover:text-blue-500 transition-colors group"
                  >
                    <Mail size={20} className="group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-black uppercase tracking-widest">eran@bridgeops-engineering.com</span>
                  </a>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-12 text-left">
              <div className="space-y-6">
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.3em]">Navigation</p>
                <ul className="space-y-3 text-xs font-bold uppercase tracking-tight">
                  <li><button onClick={() => navigateTo('methodology')} className="hover:text-blue-500 transition-colors">Methodology</button></li>
                  <li><button onClick={() => navigateTo('services')} className="hover:text-blue-500 transition-colors">Services</button></li>
                  <li><button onClick={() => navigateTo('ramp_score')} className="hover:text-blue-500 transition-colors">Ramp Score</button></li>
                  <li><button onClick={() => navigateTo('pricing')} className="hover:text-blue-500 transition-colors">Engagements</button></li>
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
            <p>© {new Date().getFullYear()} BridgeOps.ENGINEERING | Eran Hakun. All Rights Reserved.</p>
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
