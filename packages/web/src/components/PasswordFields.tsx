import { useId } from 'react';

/** Requirement 1.3. Matches `minimum_password_length` in supabase/config.toml. */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Checks a new password before it is sent.
 *
 * Only what the user can act on. Supabase enforces the real rule and, on a paid plan, checks the password
 * against known breaches — a check this cannot replicate and should not pretend to.
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
 * Two fields rather than one with a reveal toggle. This is the one moment where a typo locks someone out of
 * their own account, and a confirmation is cheap. `autoComplete="new-password"` on both, so a password
 * manager offers to generate rather than to fill.
 *
 * The hint is `aria-describedby` rather than inside the label, or the control's accessible name becomes
 * "New passwordAt least 10 characters." and is read in full on every focus.
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
  const id = useId();
  const passwordId = `${id}-password`;
  const confirmId = `${id}-confirm`;
  const hintId = `${id}-hint`;

  return (
    <>
      <div className="field">
        <label className="field__label" htmlFor={passwordId}>
          {label}
        </label>
        <input
          id={passwordId}
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
        {/* Stated up front rather than only after a failed attempt, so the rule is known before typing. */}
        <p className="field__hint" id={hintId}>
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={confirmId}>
          Confirm password
        </label>
        <input
          id={confirmId}
          className="field__input"
          type="password"
          name="passwordConfirmation"
          autoComplete="new-password"
          required
          disabled={disabled}
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)}
        />
      </div>
    </>
  );
}
