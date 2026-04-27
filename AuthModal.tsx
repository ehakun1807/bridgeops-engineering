
import React, { useState } from 'react';
import { auth, db } from './firebase.ts';
import {
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signOut,
  deleteUser
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { X, Mail, Lock, Chrome, Rocket, Loader2 } from 'lucide-react';
import { isAdminUser } from './config.ts';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PRIVATE_BETA_MSG =
  'The BridgeOps platform is invite-only right now. To explore working together, see the Engagements page or book a discovery call.';

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  /**
   * Reject a signed-in user who isn't the admin. For Google OAuth we ALSO
   * delete the Firebase Auth account that was just auto-created on first
   * sign-in, so random Gmail users don't accumulate in the auth user table.
   * (Email/password sign-ins can't create new accounts here anymore, so no
   * deletion is needed for that path.)
   */
  const rejectNonAdmin = async (wasJustCreatedViaGoogle: boolean) => {
    const current = auth.currentUser;
    try {
      if (wasJustCreatedViaGoogle && current) {
        // Requires recent auth — which Google just provided, so this works.
        await deleteUser(current);
      } else {
        await signOut(auth);
      }
    } catch {
      // If deletion fails for any reason, fall back to signing out.
      try { await signOut(auth); } catch { /* no-op */ }
    }
    setError(PRIVATE_BETA_MSG);
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      if (!isAdminUser(user.email)) {
        await rejectNonAdmin(true);
        return;
      }

      // Admin path — make sure a user doc exists.
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          userId: user.uid,
          email: user.email,
          displayName: user.displayName,
          role: 'admin',
          plan: 'enterprise',
          createdAt: serverTimestamp()
        });
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const user = result.user;

      if (!isAdminUser(user.email)) {
        await rejectNonAdmin(false);
        return;
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      // Don't leak whether the account exists — same opaque message either way.
      const code: string = err?.code ?? '';
      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        setError('Invalid email or password.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many attempts. Try again later.');
      } else {
        setError(err?.message || 'Sign-in failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={onClose}></div>

      <div className="relative bg-white w-full max-w-md p-8 shadow-2xl rounded-sm overflow-hidden border border-slate-200">
        <div className="absolute top-0 right-0 p-4">
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-blue-50 rounded-full mb-4">
            <Rocket className="text-blue-600" size={32} />
          </div>
          <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">
            Admin Sign In
          </h2>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-2">
            BridgeOps Engineering — Private Beta
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-600 text-[11px] font-bold leading-relaxed border-l-4 border-red-500">
            {error}
          </div>
        )}

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 pl-12 pr-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                placeholder="name@company.com"
                autoComplete="email"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 pl-12 pr-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 text-white py-4 font-black uppercase tracking-widest text-xs hover:bg-slate-800 transition-all shadow-xl flex items-center justify-center disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
            Sign In
          </button>
        </form>

        <div className="my-8 flex items-center gap-4 text-slate-300">
          <div className="flex-grow h-px bg-slate-100"></div>
          <span className="text-[10px] font-black uppercase tracking-widest">or</span>
          <div className="flex-grow h-px bg-slate-100"></div>
        </div>

        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full border-2 border-slate-900 text-slate-900 py-4 font-black uppercase tracking-widest text-xs hover:bg-slate-900 hover:text-white transition-all flex items-center justify-center gap-3 disabled:opacity-60"
        >
          <Chrome size={18} />
          Continue with Google
        </button>

        <p className="mt-8 text-center text-slate-400 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
          Access is invite-only. Want on the list?
          <br />
          <button
            type="button"
            onClick={() => {
              onClose();
              window.location.hash = '/pricing';
            }}
            className="text-blue-600 mt-2 inline-block hover:underline"
          >
            Join the Waitlist
          </button>
        </p>
      </div>
    </div>
  );
};

export default AuthModal;
