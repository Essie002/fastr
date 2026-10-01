import { useState } from 'react';
import type { Theme } from '@fastr/shared';
import { useAuth } from '../auth/AuthProvider.js';
import { HEALTH_NOTICE_TEXT } from '../auth/HealthNotice.js';
import { useProfile, useSaveProfile } from '../data/useProfile.js';
import { SelectField, ToggleField } from '../components/Field.js';
import {
  MIN_PASSWORD_LENGTH,
  PasswordFields,
  describePasswordProblem,
} from '../components/PasswordFields.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { commonTimeZones } from '../time/zones.js';
import { NotificationSettings } from '../pwa/NotificationSettings.js';

/**
 * Settings. Requirements 2.6, 2.7, 3.1, 3.2, 14.1.
 *
 * Preferences save on change rather than behind a Save button. There is no multi-field form to validate as
 * a whole here, and a Save button on a settings screen is a thing people forget to press. The name is the
 * exception: saving per keystroke would write a row for every letter, so it commits on blur.
 */
export default function Settings() {
  const { email, signOut, signOutOtherDevices, setPassword } = useAuth();
  const profile = useProfile();
  const save = useSaveProfile();
  const { setTheme } = useTheme();

  if (profile.isLoading) {
    return (
      <div className="stack">
        <h1>Settings</h1>
        <p role="status">Loading your settings…</p>
      </div>
    );
  }

  if (profile.isError || !profile.data) {
    return (
      <div className="stack">
        <h1>Settings</h1>
        <p className="form-error" role="alert">
          Your settings could not be loaded. Check your connection and reload.
        </p>
      </div>
    );
  }

  const p = profile.data;

  return (
    <div className="stack">
      <h1>Settings</h1>

      {save.isError && (
        <p className="form-error" role="alert">
          That change did not save. Check your connection and try again.
        </p>
      )}

      <section className="card stack" aria-labelledby="settings-you">
        <h2 id="settings-you">You</h2>

        {/*
          Keyed by the saved name, so the field remounts when the profile changes underneath — which
          happens when a save fails and the optimistic value is rolled back. An effect syncing local state
          to the prop would do the same thing with an extra render and a lint suppression.
        */}
        <DisplayNameField
          key={p.displayName}
          value={p.displayName}
          onSave={(display_name) => save.mutate({ display_name })}
        />

        <SelectField
          label="Time zone"
          value={p.timeZone}
          options={commonTimeZones(p.timeZone)}
          hint="Used for your streaks, your daily water total, and when reminders arrive."
          onChange={(time_zone) => save.mutate({ time_zone })}
        />
      </section>

      <section className="card stack" aria-labelledby="settings-units">
        <h2 id="settings-units">Units</h2>

        <SelectField
          label="Weight"
          value={p.weightUnit}
          options={[
            { value: 'kg', label: 'Kilograms (kg)' },
            { value: 'lb', label: 'Pounds (lb)' },
          ]}
          hint="Changing this converts what you have already logged rather than reinterpreting it."
          onChange={(weight_unit) => save.mutate({ weight_unit })}
        />

        <SelectField
          label="Water"
          value={p.volumeUnit}
          options={[
            { value: 'ml', label: 'Millilitres (ml)' },
            { value: 'floz', label: 'Fluid ounces (fl oz)' },
          ]}
          onChange={(volume_unit) => save.mutate({ volume_unit })}
        />

        {/* Requirement 12.2. Always in millilitres, since it is stored that way and this is a one-off setting
            rather than something logged daily. */}
        <WaterGoalField
          key={p.waterGoalMl}
          value={p.waterGoalMl}
          onSave={(water_goal_ml) => save.mutate({ water_goal_ml })}
        />
      </section>

      <section className="card stack" aria-labelledby="settings-appearance">
        <h2 id="settings-appearance">Appearance</h2>

        <SelectField
          label="Theme"
          value={p.theme}
          options={[
            { value: 'system', label: 'Match my device' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(theme: Theme) => {
            // Applied locally first so the colours change on this tap, then saved. The theme provider
            // also writes localStorage, which is what the pre-paint script reads on the next load.
            setTheme(theme);
            save.mutate({ theme });
          }}
        />
      </section>

      <section className="card stack" aria-labelledby="settings-notifications">
        <h2 id="settings-notifications">Notifications</h2>
        <p className="field__hint">
          These decide what Fastr queues for your account. Whether this device may show them is
          below.
        </p>

        <ToggleField
          label="When a fast reaches its goal"
          checked={p.notifyGoal}
          onChange={(notify_goal) => save.mutate({ notify_goal })}
        />
        <ToggleField
          label="One hour before the goal"
          checked={p.notifyHourBefore}
          onChange={(notify_hour_before) => save.mutate({ notify_hour_before })}
        />
        <ToggleField
          label="At each fasting stage"
          description="Several per fast, so a long fast means several notifications."
          checked={p.notifyStages}
          onChange={(notify_stages) => save.mutate({ notify_stages })}
        />
      </section>

      <NotificationSettings />

      <ChangePassword onSave={setPassword} />

      <section className="card stack" aria-labelledby="settings-sessions">
        <h2 id="settings-sessions">Sessions</h2>
        <p className="muted">
          Signed in as <strong>{email ?? '…'}</strong>
        </p>
        <SessionButtons signOut={signOut} signOutOtherDevices={signOutOtherDevices} />
      </section>

      <section className="card stack" aria-labelledby="settings-health">
        <h2 id="settings-health">Health notice</h2>
        {HEALTH_NOTICE_TEXT.map((paragraph) => (
          <p className="muted" key={paragraph.slice(0, 24)}>
            {paragraph}
          </p>
        ))}
      </section>
    </div>
  );
}

/**
 * The display name, committed on blur.
 *
 * Local state mirrors the profile so typing is responsive, and an effect re-syncs it when the profile
 * changes underneath — which happens when a save fails and the optimistic value is rolled back.
 */
function DisplayNameField({ value, onSave }: { value: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value);

  return (
    <label className="field">
      <span className="field__label">Your name</span>
      <input
        className="field__input"
        type="text"
        maxLength={40}
        autoComplete="name"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          // An empty name would fail the database check constraint, so it is refused here with the old
          // value restored rather than sent and bounced.
          if (trimmed === '') {
            setDraft(value);
            return;
          }
          if (trimmed !== value) onSave(trimmed);
        }}
      />
    </label>
  );
}

/** Requirement 3.2. */
function ChangePassword({
  onSave,
}: {
  onSave: (password: string) => Promise<{ error: string | null }>;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const problem = describePasswordProblem(password, confirmation);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    const result = await onSave(password);
    setBusy(false);

    if (result.error) {
      // Supabase requires a recent sign-in for this (secure_password_change), and the message it returns
      // is about reauthentication rather than about the password itself.
      setError(
        /reauthentication|recently|session/i.test(result.error)
          ? 'For this you need to have signed in recently. Sign out, sign back in, and try again.'
          : result.error,
      );
      return;
    }

    setPassword('');
    setConfirmation('');
    setDone(true);
    setOpen(false);
  }

  return (
    <section className="card stack" aria-labelledby="settings-password">
      <h2 id="settings-password">Password</h2>

      {done && !open && (
        <p role="status" className="muted">
          Your password has been changed. Your other devices will need it next time they sign in.
        </p>
      )}

      {open ? (
        <form className="stack" onSubmit={submit} noValidate>
          <PasswordFields
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
            {busy ? 'Saving…' : 'Save password'}
          </button>
          <button className="button button--link" type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button className="button button--secondary" type="button" onClick={() => setOpen(true)}>
          Change password
        </button>
      )}
    </section>
  );
}

function SessionButtons({
  signOut,
  signOutOtherDevices,
}: {
  signOut: () => Promise<void>;
  signOutOtherDevices: () => Promise<{ error: string | null }>;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');

  return (
    <>
      <button className="button button--secondary" type="button" onClick={() => void signOut()}>
        Sign out
      </button>

      <div>
        <button
          className="button button--secondary"
          type="button"
          disabled={state === 'busy'}
          onClick={() => {
            setState('busy');
            void signOutOtherDevices().then(({ error }) => setState(error ? 'failed' : 'done'));
          }}
        >
          {state === 'busy' ? 'Signing out…' : 'Sign out of other devices'}
        </button>
        {/* Announced, because the button itself does not visibly change. */}
        <p className="muted" role="status" style={{ marginTop: 'var(--space-2)' }}>
          {state === 'done' && 'Every other device has been signed out.'}
          {state === 'failed' && 'That did not work. Try again in a moment.'}
        </p>
      </div>
    </>
  );
}

/**
 * The daily water goal, committed on blur like the display name.
 *
 * Bounded here as well as in the database, and the range is wide: 100 ml is implausibly low and 10 litres is
 * past the point where water becomes dangerous, so both ends are worth refusing rather than storing.
 */
function WaterGoalField({ value, onSave }: { value: number; onSave: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));

  return (
    <div className="field">
      <label className="field__label" htmlFor="water-goal">
        Daily water goal (ml)
      </label>
      <input
        id="water-goal"
        className="field__input"
        type="number"
        inputMode="numeric"
        min={100}
        max={10000}
        step={50}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = Number(draft);
          if (!Number.isFinite(parsed) || parsed < 100 || parsed > 10_000) {
            setDraft(String(value));
            return;
          }
          const rounded = Math.round(parsed);
          if (rounded !== value) onSave(rounded);
        }}
      />
    </div>
  );
}
