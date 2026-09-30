import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.js';
import { HEALTH_NOTICE_TEXT } from '../auth/HealthNotice.js';
import { fetchProfile, profileQueryKey } from '../data/profile.js';

/**
 * Settings.
 *
 * Task 11 builds the editable parts: name, time zone, units, theme, notification preferences. What is real
 * here is the session management from Requirements 2.5 and 2.6, because sign-out is what makes the app
 * usable without clearing storage by hand, and the health notice, which Requirement 17.1 says must remain
 * readable after it has been acknowledged.
 */
export default function Settings() {
  const { email, signOut, signOutOtherDevices } = useAuth();
  const profile = useQuery({ queryKey: profileQueryKey, queryFn: fetchProfile });

  const [othersState, setOthersState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');

  async function onSignOutOthers() {
    setOthersState('busy');
    const { error } = await signOutOtherDevices();
    setOthersState(error ? 'failed' : 'done');
  }

  return (
    <div className="stack">
      <h1>Settings</h1>

      <section className="card stack">
        <h2>Account</h2>
        <p className="muted">
          Signed in as <strong>{email ?? '…'}</strong>
          {profile.data && <> as {profile.data.displayName}</>}
        </p>

        <button className="button button--secondary" type="button" onClick={() => void signOut()}>
          Sign out
        </button>

        <div>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void onSignOutOthers()}
            disabled={othersState === 'busy'}
          >
            {othersState === 'busy' ? 'Signing out…' : 'Sign out of other devices'}
          </button>
          {/* aria-live, so the outcome is announced: the button itself does not visibly change. */}
          <p className="muted" role="status" style={{ marginTop: 'var(--space-2)' }}>
            {othersState === 'done' && 'Every other device has been signed out.'}
            {othersState === 'failed' && 'That did not work. Try again in a moment.'}
          </p>
        </div>
      </section>

      <section className="card stack">
        <h2>Preferences</h2>
        <p className="muted">Name, time zone, units, theme and notifications arrive in task 11.</p>
      </section>

      <section className="card stack">
        <h2>Health notice</h2>
        {HEALTH_NOTICE_TEXT.map((paragraph) => (
          <p className="muted" key={paragraph.slice(0, 24)}>
            {paragraph}
          </p>
        ))}
      </section>
    </div>
  );
}
