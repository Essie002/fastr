import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.js';
import {
  MIN_PASSWORD_LENGTH,
  PasswordFields,
  describePasswordProblem,
} from '../components/PasswordFields.js';
import { profileQueryKey, updateProfile } from '../data/profile.js';

/**
 * Turning an invitation into a usable account. Requirement 1.2.
 *
 * Reached only from the callback route, which is why it checks `origin === 'invite'` rather than merely
 * checking for a session: an invite link already signs the user in, so without that check this screen
 * would be reachable by any signed-in user and would ask them to set a password for no reason.
 *
 * The display name is written to two places, deliberately. The profile row is what the app reads; the auth
 * metadata is what the profile trigger would use, and keeping them in step means a future reset does not
 * resurrect an old name.
 */
export default function AcceptInvite() {
  const { status, origin, email, setPassword, setDisplayName, clearOrigin } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [displayName, setName] = useState('');
  const [password, setPasswordValue] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const problem = describePasswordProblem(password, confirmation);
      if (problem) throw new Error(problem);

      const name = displayName.trim();
      if (name.length < 1 || name.length > 40) {
        throw new Error('Use a name between 1 and 40 characters.');
      }

      const passwordResult = await setPassword(password);
      if (passwordResult.error) throw new Error(passwordResult.error);

      const nameResult = await setDisplayName(name);
      if (nameResult.error) throw new Error(nameResult.error);

      // The trigger already created this row from the invite metadata, so this is an update rather than
      // an insert — and the client has no insert policy on profiles anyway.
      await updateProfile({
        display_name: name,
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });
    },
    onSuccess: async () => {
      // The invitation is spent. Clearing it stops this screen reappearing on the next render.
      clearOrigin();
      await queryClient.invalidateQueries({ queryKey: profileQueryKey });
      navigate('/plans', { replace: true });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  if (status === 'signedOut') return <Navigate to="/signin" replace />;

  // A signed-in user who wandered here has nothing to accept.
  if (status === 'signedIn' && origin !== 'invite') return <Navigate to="/" replace />;

  return (
    <div className="auth">
      <h1 className="auth__title">Welcome to Fastr</h1>

      <form
        className="card stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          submit.mutate();
        }}
      >
        <h2>Set up your account</h2>
        {email && (
          <p className="muted">
            Invited as <strong>{email}</strong>
          </p>
        )}

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
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <PasswordFields
          label="Choose a password"
          password={password}
          confirmation={confirmation}
          onPasswordChange={setPasswordValue}
          onConfirmationChange={setConfirmation}
          disabled={submit.isPending}
        />

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button
          className="button button--primary"
          type="submit"
          disabled={submit.isPending || password.length < MIN_PASSWORD_LENGTH}
        >
          {submit.isPending ? 'Saving…' : 'Start using Fastr'}
        </button>
      </form>
    </div>
  );
}
