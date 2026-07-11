import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

interface AuthGateProps {
  children: React.ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ tone: 'info' | 'error' | 'sent'; text: string } | null>(
    null,
  );

  useEffect(() => {
    // Check if already signed in
    supabase!.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session);
      setLoading(false);
    });

    // React to sign-in / sign-out (also fires after the emailed link is opened)
    const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session);
    });

    return () => subscription?.unsubscribe();
  }, []);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || sending) return;
    setSending(true);
    setStatus({ tone: 'info', text: 'Sending your secure sign-in link…' });

    const { error } = await supabase!.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });

    setSending(false);
    if (error) {
      setStatus({ tone: 'error', text: error.message });
    } else {
      setStatus({
        tone: 'sent',
        text: `Check ${email} for a secure link to finish signing in.`,
      });
    }
  };

  const handleGoogleAuth = async () => {
    setStatus({ tone: 'info', text: 'Redirecting to Google…' });
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) setStatus({ tone: 'error', text: error.message });
  };

  const handleSignOut = async () => {
    await supabase!.auth.signOut();
  };

  if (loading) {
    return (
      <div className="auth-screen">
        <div className="auth-loading">
          <img src="/logo.svg" alt="Loading" className="brand-logo" />
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-brand">
            <img src="/logo.svg" alt="Evolve" className="brand-logo" />
            <span className="brand-text">
              <span className="brand-name">Evolve</span>
              <span className="brand-tag">Notes that think ahead</span>
            </span>
          </div>

          <div className="auth-intro">
            <h1 className="auth-title">Sign in to continue</h1>
            <p className="auth-sub">
              Access your notes on any device. We use passwordless
              authentication — enter your email and we'll send a secure sign-in
              link.
            </p>
          </div>

          <form className="auth-form" onSubmit={handleEmailAuth}>
            <label className="auth-label" htmlFor="auth-email">
              Email address
            </label>
            <input
              id="auth-email"
              type="email"
              className="auth-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
            <button type="submit" className="auth-primary" disabled={sending}>
              {sending ? 'Sending link…' : 'Send sign-in link'}
            </button>
          </form>

          <div className="auth-divider">
            <span>or</span>
          </div>

          <button className="auth-oauth" onClick={handleGoogleAuth}>
            <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
              />
              <path
                fill="#FBBC05"
                d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
              />
            </svg>
            Continue with Google
          </button>

          {status && (
            <p className={`auth-status auth-status--${status.tone}`}>{status.text}</p>
          )}
        </div>
      </div>
    );
  }

  // Signed in — render the app with an unobtrusive sign-out control
  return (
    <>
      <button className="auth-signout" onClick={handleSignOut} title="Sign out">
        Sign out
      </button>
      {children}
    </>
  );
}
