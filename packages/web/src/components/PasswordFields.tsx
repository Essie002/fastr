import { useId } from 'react';

/** Requirement 1.3. Matches `minimum_password_length` in supabase/config.toml. */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Checks a new password before it is sent.
 *
 * Only what the user can act on. Supabase enforces the real rule and, on a paid plan, checks the password
 * against known breaches — which is a check this cannot replicate and should not pretend to.
 */
export function describePasswordProblem(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmation) return 'Those two do not match.';
  return null;
}

/**
 * A new-password pair.
 *
 * Two fields rather than one with a reveal toggle. This is the one moment where a typo locks someone out
 * of their own account, and the confirmation is cheap. `autoComplete="new-password"` on both, so a
 * password manager offers to generate rather than to fill.
 */
export function PasswordFields({
  password,
  confirmation,
  onPasswordChange,
  onConfirmationChange,
  label = 'New password',
  disabled = false,
}: {
  password: string;
  confirmation: string;
  onPasswordChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const hintId = useId();

  return (
    <>
      <label className="field">
        <span className="field__label">{label}</span>
        <input
          className="field__input"
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          disabled={disabled}
          aria-describedby={hintId}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
        {/* Described rather than shown only on failure, so the requirement is known before typing. */}
        <span className="field__hint" id={hintId}>
          At least {MIN_PASSWORD_LENGTH} characters.
        </span>
      </label>

      <label className="field">
        <span className="field__label">Confirm password</span>
        <input
          className="field__input"
          type="password"
          name="passwordConfirmation"
          autoComplete="new-password"
          required
          disabled={disabled}
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)}
        />
      </label>
    </>
  );
}
