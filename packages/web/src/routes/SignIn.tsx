import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';

/**
 * Sign in, and asking for a password reset. Requirements 1.1, 2.1, 2.2, 2.8.
 *
 * There is no sign-up form, and that is the feature: Fastr is invite-only (Requirement 1.1), so accounts
 * come from the owner inviting an address. A disabled or hidden sign-up form would imply one exists.
 */

interface LocationState {
  from?: string;
}

export default function SignIn() {
  const { status, signIn, requestPasswordReset } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');

  const from = (location.state as LocationState | null)?.from;

  // Already signed in, so this screen has nothing to do. Covers returning here by the back button and
  // arriving after a session is established by the callback route.
  if (status === 'signedIn') return <Navigate to={from ?? '/'} replace />;

  async function onSignIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn(email.trim(), password);
    setBusy(false);
    // On success the auth state change re-renders this component into the redirect above, so there is
    // nothing to navigate to here.
    if (result.error) setError(result.error);
  }

  async function onReset(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    await requestPasswordReset(email.trim());
    setBusy(false);
    // Shown whether or not the address has an account. A different answer per address would make this
    // form an account checker.
    setResetSent(true);
  }

  return (
    <div className="auth">
      <h1 className="auth__title">Fastr</h1>

      {mode === 'signin' ? (
        <form className="card stack" onSubmit={onSignIn} noValidate>
          <h2>Sign in</h2>

          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="field__input"
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="field__input"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {/*
            role="alert" here, unlike the offline banner: this is the direct result of the user pressing a
            button, so interrupting is exactly what a screen reader should do.
          */}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button className="button button--primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <button
            className="button button--link"
            type="button"
            onClick={() => {
              setMode('reset');
              setError(null);
            }}
          >
            Forgotten your password?
          </button>

          <p className="muted auth__note">
            Fastr is invite-only, so there is no sign-up here. Ask the owner for an invitation.
          </p>
        </form>
      ) : (
        <form className="card stack" onSubmit={onReset} noValidate>
          <h2>Reset your password</h2>

          {resetSent ? (
            <>
              <p role="status">
                If <strong>{email.trim()}</strong> has an account, a reset link is on its way. The
                link works once and expires after an hour.
              </p>
              <button
                className="button button--link"
                type="button"
                onClick={() => {
                  setMode('signin');
                  setResetSent(false);
                }}
              >
                Back to sign in
              </button>
            </>
          ) : (
            <>
              <p className="muted">We will email you a link to set a new one.</p>

              <label className="field">
                <span className="field__label">Email</span>
                <input
                  className="field__input"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>

              <button className="button button--primary" type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Email me a link'}
              </button>

              <button
                className="button button--link"
                type="button"
                onClick={() => setMode('signin')}
              >
                Back to sign in
              </button>
            </>
          )}
        </form>
      )}
    </div>
  );
}
