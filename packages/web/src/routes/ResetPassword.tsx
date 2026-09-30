import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import {
  MIN_PASSWORD_LENGTH,
  PasswordFields,
  describePasswordProblem,
} from '../components/PasswordFields.js';

/**
 * Setting a new password from a recovery link. Requirement 2.8.
 *
 * Requires `origin === 'recovery'`, so this cannot be reached by an ordinary signed-in user; changing a
 * password from settings is a different flow that asks for the current one (Requirement 3.2).
 *
 * Requirement 2.7 is handled by Supabase rather than here: changing a password revokes the account's other
 * sessions, which is the behaviour that matters after a reset — whoever prompted the reset loses their
 * access.
 */
export default function ResetPassword() {
  const { status, origin, setPassword, clearOrigin } = useAuth();
  const navigate = useNavigate();

  const [password, setPasswordValue] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'signedOut') return <Navigate to="/signin" replace />;
  if (status === 'signedIn' && origin !== 'recovery') return <Navigate to="/" replace />;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const problem = describePasswordProblem(password, confirmation);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    const result = await setPassword(password);
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    clearOrigin();
    navigate('/', { replace: true });
  }

  return (
    <div className="auth">
      <h1 className="auth__title">Fastr</h1>

      <form className="card stack" onSubmit={onSubmit} noValidate>
        <h2>Choose a new password</h2>
        <p className="muted">Signing in again on your other devices will need this new password.</p>

        <PasswordFields
          password={password}
          confirmation={confirmation}
          onPasswordChange={setPasswordValue}
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
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </div>
  );
}
