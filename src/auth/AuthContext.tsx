import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { firebaseAuth, firebaseConfigured } from '../firebase';

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
    return onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
      setError('');
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
        await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
      } catch {
        setError('Google sign-in failed. Check the Firebase provider and authorized domains.');
      }
    },
    async signOut() {
      if (!firebaseAuth) return;
      try {
        await signOut(firebaseAuth);
      } catch {
        setError('Sign-out failed. Reload the page and try again.');
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
