import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';
import { renderApp } from '../test/render.js';
import {
  clearSupabaseStub,
  installSupabaseStub,
  makeSession,
  profileRow,
} from '../test/supabaseStub.js';
import {
  describeScheduleProblem,
  occurrencesPerDay,
  type ScheduleDraft,
} from '../components/ScheduleFields.js';

/**
 * The activities screen. Requirements 1, 5, 7.
 *
 * The stub returns rows rather than simulating Postgres, so what is asserted here is what the screen does with
 * what the server said — the constraints themselves are proved in `supabase/tests` against real Postgres.
 */

afterEach(clearSupabaseStub);

/** A nested activity row in the shape the Supabase join returns. */
function activityRow(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function signedIn(tables: Record<string, unknown[]> = {}) {
  return installSupabaseStub({
    session: makeSession(),
    tables: { profiles: [profileRow()], activities: [], activity_log: [], ...tables },
  });
}

describe('the activities screen', () => {
  it('is reachable from the navigation', async () => {
    signedIn();
    renderApp(<App />, { route: '/' });
    await screen.findByRole('heading', { level: 1, name: 'Timer' });

    await userEvent.click(screen.getByRole('link', { name: /activity/i }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Activities' }),
    ).toBeInTheDocument();
  });

  it('offers a first step when there is nothing yet (Req 6.5)', async () => {
    signedIn();
    renderApp(<App />, { route: '/activities' });

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Nothing yet' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add your first activity/i })).toBeInTheDocument();
  });

  it('lists an activity with its schedule in words (Req 7.1, 7.2)', async () => {
    signedIn({ activities: [activityRow()] });
    renderApp(<App />, { route: '/activities' });

    expect(await screen.findByRole('heading', { level: 2, name: /swim/i })).toBeInTheDocument();
    // `describeWeekdays` plus the time, not a raw array of day numbers.
    expect(screen.getByText(/tuesday at 07:00/i)).toBeInTheDocument();
    expect(screen.getByText(/45 minutes/i)).toBeInTheDocument();
  });

  it('describes an interval schedule in hours (Req 7.2)', async () => {
    signedIn({
      activities: [
        activityRow({
          type_key: 'water',
          duration_minutes: 1,
          activity_schedules: [
            {
              id: 'schedule-2',
              kind: 'every',
              local_time: null,
              window_start: '08:00:00',
              window_end: '20:00:00',
              interval_minutes: 120,
              weekdays: [1, 2, 3, 4, 5],
              enabled: true,
            },
          ],
        }),
      ],
    });
    renderApp(<App />, { route: '/activities' });

    expect(await screen.findByText(/weekdays every 2 hours, 08:00 to 20:00/i)).toBeInTheDocument();
  });

  it('shows the next occurrence (Req 7.4)', async () => {
    signedIn({ activities: [activityRow()] });
    renderApp(<App />, { route: '/activities' });

    // The exact time depends on the day the test runs, so the assertion is on the shape: a schedule that
    // is configured produces a "next at" rather than "not scheduled".
    expect(await screen.findByText(/next at 07:00/i)).toBeInTheDocument();
  });

  it('says so when an activity has no schedule, rather than looking fine', async () => {
    signedIn({ activities: [activityRow({ activity_schedules: [] })] });
    renderApp(<App />, { route: '/activities' });

    expect(await screen.findByText(/no schedule yet/i)).toBeInTheDocument();
  });

  it('turns reminders off in one action, without opening anything (Req 7.3)', async () => {
    const stub = signedIn({ activities: [activityRow()] });
    renderApp(<App />, { route: '/activities' });

    const toggle = await screen.findByRole('checkbox', { name: /remind me about swim/i });
    await userEvent.click(toggle);

    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith('activities', { enabled: false });
    });
  });

  it('logs a completion in one tap (Req 5.1)', async () => {
    const stub = signedIn({ activities: [activityRow()] });
    renderApp(<App />, { route: '/activities' });

    await userEvent.click(await screen.findByRole('button', { name: /log swim/i }));

    await waitFor(() => {
      expect(stub.calls.insert).toHaveBeenCalledWith(
        'activity_log',
        expect.objectContaining({ label: 'Swim', type_key: 'swim', minutes: 45, source: 'manual' }),
      );
    });
    // Acknowledged, or a tap that wrote a row looks like a tap that did nothing and people tap again.
    expect(await screen.findByText('Logged')).toBeInTheDocument();
  });

  it('sends a water completion to the water feature instead (Req 5.6)', async () => {
    const stub = signedIn({
      activities: [activityRow({ type_key: 'water', duration_minutes: 1 })],
    });
    renderApp(<App />, { route: '/activities' });

    await userEvent.click(await screen.findByRole('button', { name: /\+ 250 ml/i }));

    await waitFor(() => {
      expect(stub.calls.insert).toHaveBeenCalledWith(
        'water_entries',
        expect.objectContaining({ ml: 250 }),
      );
    });
    // Two records of how much someone drank would show up as the goal not moving.
    expect(stub.calls.insert).not.toHaveBeenCalledWith('activity_log', expect.anything());
  });

  it('uses the custom label for an activity with no preset (Req 1.4)', async () => {
    signedIn({
      activities: [activityRow({ type_key: null, custom_label: 'Physio', duration_minutes: 20 })],
    });
    renderApp(<App />, { route: '/activities' });

    expect(await screen.findByRole('heading', { level: 2, name: /physio/i })).toBeInTheDocument();
  });
});

describe('adding an activity', () => {
  it('creates the activity and its first schedule together', async () => {
    const stub = signedIn();
    renderApp(<App />, { route: '/activities' });

    await userEvent.click(await screen.findByRole('button', { name: /add your first activity/i }));
    await userEvent.selectOptions(screen.getByLabelText('What'), 'swim');
    await userEvent.click(screen.getByRole('button', { name: 'Add activity' }));

    await waitFor(() => {
      expect(stub.calls.insert).toHaveBeenCalledWith(
        'activities',
        expect.objectContaining({ type_key: 'swim', duration_minutes: 45 }),
      );
    });
    // An activity with no schedule never fires, so both writes have to happen.
    await waitFor(() => {
      expect(stub.calls.insert).toHaveBeenCalledWith(
        'activity_schedules',
        expect.objectContaining({ kind: 'at', local_time: '07:00' }),
      );
    });
  });

  it('follows the preset duration when the type changes', async () => {
    signedIn();
    renderApp(<App />, { route: '/activities' });

    await userEvent.click(await screen.findByRole('button', { name: /add your first activity/i }));
    // Walk defaults to 20; switching to stretch must not leave 20 behind.
    await userEvent.selectOptions(screen.getByLabelText('What'), 'stretch');
    expect(screen.getByLabelText('How long')).toHaveValue(10);
  });

  it('asks for a name when the type is custom, and refuses a blank one', async () => {
    const stub = signedIn();
    renderApp(<App />, { route: '/activities' });

    await userEvent.click(await screen.findByRole('button', { name: /add your first activity/i }));
    await userEvent.selectOptions(screen.getByLabelText('What'), '__custom__');
    await userEvent.click(screen.getByRole('button', { name: 'Add activity' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/give your activity a name/i);
    expect(stub.calls.insert).not.toHaveBeenCalled();
  });

  it('does not ask how long water takes', async () => {
    signedIn();
    renderApp(<App />, { route: '/activities' });

    await userEvent.click(await screen.findByRole('button', { name: /add your first activity/i }));
    await userEvent.selectOptions(screen.getByLabelText('What'), 'water');

    // Water is a volume. A duration field for it is the wrong question, and an end reminder is meaningless.
    expect(screen.queryByLabelText('How long')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: /when it should be finished/i }),
    ).not.toBeInTheDocument();
  });

  it('shows how many notifications an interval schedule would send', async () => {
    signedIn();
    renderApp(<App />, { route: '/activities' });

    await userEvent.click(await screen.findByRole('button', { name: /add your first activity/i }));
    await userEvent.click(screen.getByRole('radio', { name: /repeatedly/i }));

    // The cheapest guard in the feature: 08:00–20:00 every two hours is seven, and seeing the number is
    // what stops someone saving sixty-four by accident.
    expect(await screen.findByText(/remind you 7 times a day/i)).toBeInTheDocument();
  });

  it('refuses a window shorter than its interval (Req 3.2)', async () => {
    const stub = signedIn();
    renderApp(<App />, { route: '/activities' });

    await userEvent.click(await screen.findByRole('button', { name: /add your first activity/i }));
    await userEvent.click(screen.getByRole('radio', { name: /repeatedly/i }));
    await userEvent.clear(screen.getByLabelText('Until'));
    await userEvent.type(screen.getByLabelText('Until'), '09:00');
    await userEvent.click(screen.getByRole('button', { name: 'Add activity' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/only ever remind you once/i);
    expect(stub.calls.insert).not.toHaveBeenCalled();
  });

  it('refuses an empty weekday list', async () => {
    const stub = signedIn();
    renderApp(<App />, { route: '/activities' });

    await userEvent.click(await screen.findByRole('button', { name: /add your first activity/i }));
    // Weekdays are on by default; clearing all five leaves a schedule that can never fire.
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      await userEvent.click(screen.getByRole('checkbox', { name: day }));
    }
    await userEvent.click(screen.getByRole('button', { name: 'Add activity' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one day/i);
    expect(stub.calls.insert).not.toHaveBeenCalled();
  });

  it('explains the activity limit rather than showing a database error', async () => {
    installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()], activities: [], activity_log: [] },
      tableErrors: { activities: { message: 'You can have at most 20 activities.' } },
    });
    renderApp(<App />, { route: '/activities' });

    await userEvent.click(await screen.findByRole('button', { name: /add your first activity/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Add activity' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 20 activities/i);
  });
});

describe('the schedule helpers', () => {
  const base: ScheduleDraft = {
    kind: 'every',
    localTime: '07:00',
    windowStart: '08:00',
    windowEnd: '20:00',
    intervalMinutes: 120,
    weekdays: [1],
  };

  it('counts occurrences inclusively of the window end', () => {
    // 08, 10, 12, 14, 16, 18, 20 — seven, matching generate_series in SQL.
    expect(occurrencesPerDay(base)).toBe(7);
  });

  it('counts a step that does not divide the window', () => {
    // 08:00, 10:30, 13:00, 15:30, 18:00 — five, and never 20:30.
    expect(occurrencesPerDay({ ...base, intervalMinutes: 150 })).toBe(5);
  });

  it('counts a wall-clock schedule as one', () => {
    expect(occurrencesPerDay({ ...base, kind: 'at' })).toBe(1);
  });

  it('names the problems a user can fix', () => {
    expect(describeScheduleProblem({ ...base, weekdays: [] })).toMatch(/at least one day/i);
    expect(describeScheduleProblem({ ...base, windowEnd: '07:00' })).toMatch(/after the start/i);
    expect(describeScheduleProblem({ ...base, windowEnd: '09:00' })).toMatch(/only ever remind/i);
    expect(describeScheduleProblem(base)).toBeNull();
  });
});
