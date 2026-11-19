import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signOut, type User } from 'firebase/auth';
import { firebaseAuth, firebaseConfigured } from '../firebase';
import { clearOffline } from '../offline';

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  user: User | null;
  error: string;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(firebaseConfigured);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!firebaseAuth) return;
    let previousUid: string | undefined;
    let generation = 0;
    return onAuthStateChanged(firebaseAuth, async (nextUser) => {
      const current = ++generation;
      const oldUid = previousUid;
      previousUid = nextUser?.uid;
      setLoading(true);
      setUser(null);
      let cleanupError = '';
      if (oldUid && oldUid !== nextUser?.uid) {
        try { await clearOffline(oldUid); }
        catch { cleanupError = 'Local copy removal failed. Clear browser data on shared devices.'; }
      }
      if (current !== generation) return;
      setUser(nextUser);
      setLoading(false);
      setError(cleanupError);
    }, () => {
      setUser(null);
      setLoading(false);
      setError('Could not restore the signed-in session. Please sign in again.');
    });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured: firebaseConfigured,
    loading,
    user,
    error,
    async signIn() {
      if (!firebaseAuth) return;
      setError('');
      try {
        if (Capacitor.isNativePlatform()) {
          const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
          const idToken = result.credential?.idToken;
          if (!idToken) throw new Error('Google did not return an ID token.');
          await signInWithCredential(firebaseAuth, GoogleAuthProvider.credential(idToken));
        } else {
          await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
        }
      } catch {
        setError('Google sign-in failed. Check the Firebase provider and authorized domains.');
      }
    },
    async signOut() {
      if (!firebaseAuth) return;
      let cleanupFailed = false;
      if (firebaseAuth.currentUser) {
        try { await clearOffline(firebaseAuth.currentUser.uid); }
        catch { cleanupFailed = true; }
      }
      try {
        await signOut(firebaseAuth);
        if (cleanupFailed) setError('Signed out, but local copy removal failed. Clear browser data on shared devices.');
      } catch {
        setError('Sign-out or local-copy removal failed. Retry; clear browser data on shared devices.');
      }
    },
  }), [error, loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
