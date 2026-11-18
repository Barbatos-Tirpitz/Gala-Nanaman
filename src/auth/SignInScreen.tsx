import { Compass, LogIn } from 'lucide-react';

export default function SignInScreen({
  busy,
  error,
  onSignIn,
}: {
  busy: boolean;
  error: string;
  onSignIn: () => void;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <a className="brand auth-brand" href="#home" aria-label="Gala-Nanaman home">
          <span className="brand-mark"><Compass size={20} strokeWidth={2.2} /></span>
          <span className="brand-wordmark">gala<span>·</span>nanaman</span>
        </a>
        <p className="eyebrow"><span className="eyebrow-line" /> YOUR TRAVEL WORKSPACE</p>
        <h1>Welcome back.</h1>
        <p className="auth-copy">Sign in to open your trips and itineraries.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary auth-sign-in" disabled={busy} onClick={onSignIn}>
          <LogIn size={17} /> {busy ? 'Signing in…' : 'Continue with Google'}
        </button>
        <p className="auth-footnote">Trip data is available only to its owner.</p>
      </section>
    </main>
  );
}
