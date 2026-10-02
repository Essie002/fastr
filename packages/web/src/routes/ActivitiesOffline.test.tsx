import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { App } from '../App.js';
import { renderApp } from '../test/render.js';
import { setOnline } from '../test/setup.js';
import {
  clearSupabaseStub,
  installSupabaseStub,
  makeSession,
  profileRow,
} from '../test/supabaseStub.js';

/**
 * The activity screens offline. Requirement 9.
 *
 * Fastr is installed to a home screen and opened on a phone, so "offline" is not an edge case — it is a
 * Tuesday morning on the underground. What matters is that the screen behaves like the rest of the app rather
 * than inventing its own failure, and that the reminders themselves are unaffected, because they are queued and
 * sent by the database with no browser involved at all.
 */

afterEach(clearSupabaseStub);

const activityRow = {
  id: 'activity-1',
  type_key: 'swim',
  custom_label: null,
  duration_minutes: 45,
  notify_end: false,
  enabled: true,
  activity_schedules: [
    {
      id: 'schedule-1',
      kind: 'at',
      local_time: '07:00:00',
      window_start: null,
      window_end: null,
      interval_minutes: null,
      weekdays: [2],
      enabled: true,
    },
  ],
};

describe('activities offline (Req 9)', () => {
  it('shows the same offline banner the rest of the app uses', async () => {
    installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()], activities: [activityRow], activity_log: [] },
    });
    renderApp(<App />, { route: '/activities' });
    await screen.findByRole('heading', { level: 1, name: 'Activities' });

    setOnline(false);

    // The shell's banner, not a per-screen message. One explanation of being offline is enough, and a
    // second one on this screen would read as a different problem.
    expect(await screen.findByText(/you are offline/i)).toBeInTheDocument();
  });

  it('keeps showing cached activities rather than emptying the list', async () => {
    installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()], activities: [activityRow], activity_log: [] },
    });
    renderApp(<App />, { route: '/activities' });
    await screen.findByRole('heading', { level: 2, name: /swim/i });

    setOnline(false);

    // Still there. A list that empties itself when the network drops looks like data loss, which is the
    // worst possible impression for the screen holding the user's schedules.
    expect(screen.getByRole('heading', { level: 2, name: /swim/i })).toBeInTheDocument();
    expect(screen.getByText(/tuesday at 07:00/i)).toBeInTheDocument();
  });

  it('still shows the next occurrence, because it is computed locally', async () => {
    /*
     * This is the payoff for duplicating the occurrence arithmetic in TypeScript rather than asking the
     * database. Offline, the one number that tells the user their schedule is correct is still there.
     */
    installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()], activities: [activityRow], activity_log: [] },
    });
    renderApp(<App />, { route: '/activities' });
    await screen.findByText(/next at 07:00/i);

    setOnline(false);

    expect(screen.getByText(/next at 07:00/i)).toBeInTheDocument();
  });
});
