import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import {
  MIN_PASSWORD_LENGTH,
  PasswordFields,
  describePasswordProblem,
} from '../components/PasswordFields.js';

/**
 * Creating an account. Requirement 1.1.
 *
 * Everything this screen collects is sent in one `signUp` call, as auth metadata, because the profile row
 * is created by a database trigger reading that metadata — not by this client, which has no insert policy
 * on `profiles`. So there is no second request to fail halfway and no window in which an account exists
 * without a profile.
 *
 * The time zone is captured here rather than asked for (Requirement 1.6). The browser already knows it,
 * and a timezone dropdown as the second field of a sign-up form is a good way to lose someone.
 */

interface LocationState {
  from?: string;
}

export default function SignUp() {
  const { status, signUp } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const from = (location.state as LocationState | null)?.from;

  // With confirmations off, a successful sign-up lands here: the auth state change re-renders this
  // component, and this redirect is what actually sends the new user into the app.
  if (status === 'signedIn') return <Navigate to={from ?? '/plans'} replace />;

  if (awaitingConfirmation) {
    return (
      <div className="auth">
        <h1 className="auth__title">Fastr</h1>
        <div className="card stack">
          <h2>Check your inbox</h2>
          <p role="status">
            If <strong>{email.trim()}</strong> is yours, a confirmation link is on its way. Open it
            and you will be signed in.
          </p>
          <Link className="button button--link" to="/signin">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    const name = displayName.trim();
    if (name.length < 1 || name.length > 40) {
      setError('Use a name between 1 and 40 characters.');
      return;
    }
    const problem = describePasswordProblem(password, confirmation);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    const outcome = await signUp(
      email.trim(),
      password,
      name,
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    );
    setBusy(false);

    if (outcome.kind === 'error') setError(outcome.message);
    else if (outcome.kind === 'confirmationSent') setAwaitingConfirmation(true);
    // 'signedIn' needs nothing: the redirect above takes over on the next render.
  }

  return (
    <div className="auth">
      <h1 className="auth__title">Fastr</h1>

      <form className="card stack" onSubmit={onSubmit} noValidate>
        <h2>Create your account</h2>
        <p className="muted">Track your fasts, your streaks and your weight. Free, and yours.</p>

        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="field__input"
            type="text"
            name="displayName"
            autoComplete="name"
            required
            maxLength={40}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>

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

        <PasswordFields
          label="Choose a password"
          password={password}
          confirmation={confirmation}
          onPasswordChange={setPassword}
          onConfirmationChange={setConfirmation}
          disabled={busy}
        />

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button
          className="button button--primary"
          type="submit"
          disabled={busy || password.length < MIN_PASSWORD_LENGTH}
        >
          {busy ? 'Creating your account…' : 'Create account'}
        </button>

        <p className="muted auth__note">
          Already have an account? <Link to="/signin">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
