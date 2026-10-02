import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';
import { renderApp } from './test/render.js';
import { expectNoAxeViolations } from './test/axe.js';
import { setOnline } from './test/setup.js';
import {
  clearSupabaseStub,
  installSupabaseStub,
  makeSession,
  profileRow,
} from './test/supabaseStub.js';

/**
 * Automated accessibility checks on every screen. Requirement 19.5.
 *
 * Every state, not just the happy one: empty, loaded, error and offline each produce different markup, and the
 * error states are where a `role` or a label is most likely to have been forgotten.
 *
 * What this cannot tell us is in the README, and the list is not short: whether an announcement arrives at a useful
 * moment, whether the timer is usable with a real screen reader, and whether contrast holds on a real screen. A
 * green run here is necessary and nowhere near sufficient.
 */

const activeFast = {
  id: 'fast-1',
  user_id: '11111111-1111-4111-8111-111111111111',
  plan_id: '16:8',
  goal_minutes: 960,
  start_at: new Date(Date.now() - 4 * 3_600_000).toISOString(),
  ended_at: null,
  status: 'active',
  mood: null,
  energy: null,
  note: null,
};

const finishedFast = {
  ...activeFast,
  id: 'fast-2',
  start_at: new Date(Date.now() - 30 * 3_600_000).toISOString(),
  ended_at: new Date(Date.now() - 13 * 3_600_000).toISOString(),
  status: 'completed',
  mood: 4,
  energy: 3,
  note: 'Fine',
};

function fullStub(overrides: Record<string, unknown[]> = {}) {
  return installSupabaseStub({
    session: makeSession(),
    tables: {
      profiles: [profileRow()],
      fasts: [],
      weight_entries: [],
      water_entries: [],
      day_notes: [],
      reminders: [],
      push_subscriptions: [],
      ...overrides,
    },
  });
}

beforeEach(() => {
  fullStub();
});

afterEach(clearSupabaseStub);

describe('every screen, signed in', () => {
  it.each([
    ['/', 'Timer'],
    ['/plans', 'Plans'],
    ['/history', 'History'],
    ['/stats', 'Stats'],
    ['/settings', 'Settings'],
  ])('%s has no violations when empty', async (route, heading) => {
    const { container } = renderApp(<App />, { route });
    await screen.findByRole('heading', { level: 1, name: heading, hidden: true });
    await expectNoAxeViolations(container);
  });

  it('the timer has no violations with a fast running', async () => {
    fullStub({ fasts: [activeFast] });
    const { container } = renderApp(<App />, { route: '/' });
    await screen.findByText('4h 00m');
    await expectNoAxeViolations(container);
  });

  it('the timer has no violations while ending a fast', async () => {
    // A different tree: a dialog, a details element, two radio groups and a textarea.
    fullStub({ fasts: [activeFast] });
    const { container } = renderApp(<App />, { route: '/' });
    await userEvent.click(await screen.findByRole('button', { name: 'End fast' }));
    await screen.findByRole('alertdialog', { name: /end this fast/i });
    await expectNoAxeViolations(container);
  });

  it('history has no violations with fasts in it', async () => {
    fullStub({ fasts: [finishedFast] });
    const { container } = renderApp(<App />, { route: '/history' });
    await screen.findByRole('button', { name: /edit/i });
    await expectNoAxeViolations(container);
  });

  it('the history calendar has no violations', async () => {
    // A table with row and column headers, which is where header scoping goes wrong.
    fullStub({ fasts: [finishedFast] });
    const { container } = renderApp(<App />, { route: '/history' });
    await screen.findByRole('button', { name: /edit/i });
    await userEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    await screen.findByRole('table');
    await expectNoAxeViolations(container);
  });

  it('the edit form has no violations', async () => {
    fullStub({ fasts: [finishedFast] });
    const { container } = renderApp(<App />, { route: '/history' });
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    await screen.findByRole('heading', { name: /edit this fast/i });
    await expectNoAxeViolations(container);
  });

  it('stats has no violations with data and a chart', async () => {
    fullStub({
      fasts: [finishedFast],
      weight_entries: [
        {
          id: 'w1',
          user_id: '11111111-1111-4111-8111-111111111111',
          measured_on: new Date().toISOString().slice(0, 10),
          grams: 72_000,
        },
      ],
    });
    const { container } = renderApp(<App />, { route: '/stats' });
    await screen.findByText(/readings as a table/i);
    await expectNoAxeViolations(container);
  });

  it('settings has no violations with reminders and devices', async () => {
    fullStub({
      reminders: [
        {
          id: 'r1',
          user_id: '11111111-1111-4111-8111-111111111111',
          local_time: '20:00:00',
          weekdays: [1, 2, 3, 4, 5],
          enabled: true,
        },
      ],
      push_subscriptions: [
        {
          id: 's1',
          endpoint: 'https://push.example.test/a',
          user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
          created_at: '2026-09-01T00:00:00.000Z',
          last_ok_at: null,
          failures: 0,
        },
      ],
    });
    const { container } = renderApp(<App />, { route: '/settings' });
    await screen.findByRole('heading', { name: 'Reminders' });
    await expectNoAxeViolations(container);
  });

  it('the delete-account confirmation has no violations', async () => {
    const { container } = renderApp(<App />, { route: '/settings' });
    await userEvent.click(await screen.findByRole('button', { name: /delete my account/i }));
    await screen.findByRole('alertdialog');
    await expectNoAxeViolations(container);
  });

  it('the plan catalog has no violations with the extended notice open', async () => {
    const { container } = renderApp(<App />, { route: '/plans' });
    await userEvent.click(await screen.findByRole('button', { name: /36 hours/ }));
    await screen.findByRole('alertdialog');
    await expectNoAxeViolations(container);
  });
});

describe('error and offline states', () => {
  it('the settings error state has no violations', async () => {
    installSupabaseStub({
      session: makeSession(),
      tableErrors: { profiles: { message: 'network down' } },
    });
    const { container } = renderApp(<App />, { route: '/settings' });
    await screen.findByRole('alert');
    await expectNoAxeViolations(container);
  });

  it('the history error state has no violations', async () => {
    installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()] },
      tableErrors: { fasts: { message: 'network down' } },
    });
    const { container } = renderApp(<App />, { route: '/history' });
    await screen.findByRole('alert');
    await expectNoAxeViolations(container);
  });

  it('the offline banner has no violations', async () => {
    const { container } = renderApp(<App />, { route: '/' });
    await screen.findByRole('heading', { name: /ready when you are/i });
    setOnline(false);
    await screen.findByText(/you are offline/i);
    await expectNoAxeViolations(container);
  });

  /** Requirement 10. The activity screens, empty and populated, plus the add form. */
  describe('activities', () => {
    const activityRow = {
      id: 'activity-1',
      type_key: 'swim',
      custom_label: null,
      duration_minutes: 45,
      notify_end: true,
      enabled: true,
      activity_schedules: [
        {
          id: 'schedule-1',
          kind: 'at',
          local_time: '07:00:00',
          window_start: null,
          window_end: null,
          interval_minutes: null,
          weekdays: [2, 6],
          enabled: true,
        },
      ],
    };

    const logRow = {
      id: 'log-1',
      activity_id: 'activity-1',
      label: 'Swim',
      type_key: 'swim',
      occurred_at: new Date().toISOString(),
      minutes: 45,
      source: 'manual',
      note: null,
    };

    it('the empty state has no violations', async () => {
      installSupabaseStub({
        session: makeSession(),
        tables: { profiles: [profileRow()], activities: [], activity_log: [] },
      });
      const { container } = renderApp(<App />, { route: '/activities' });
      await screen.findByRole('heading', { level: 2, name: 'Nothing yet' });
      await expectNoAxeViolations(container);
    });

    it('a populated list has no violations', async () => {
      installSupabaseStub({
        session: makeSession(),
        tables: { profiles: [profileRow()], activities: [activityRow], activity_log: [logRow] },
      });
      const { container } = renderApp(<App />, { route: '/activities' });
      await screen.findByRole('heading', { level: 2, name: /swim/i });
      await expectNoAxeViolations(container);
    });

    it('the add form has no violations, in both schedule shapes', async () => {
      installSupabaseStub({
        session: makeSession(),
        tables: { profiles: [profileRow()], activities: [], activity_log: [] },
      });
      const { container } = renderApp(<App />, { route: '/activities' });
      await userEvent.click(
        await screen.findByRole('button', { name: /add your first activity/i }),
      );
      await screen.findByRole('heading', { level: 2, name: 'Add an activity' });
      await expectNoAxeViolations(container);

      // The interval shape renders different controls, including the radio group whose inputs are
      // visually hidden — the case most likely to produce an unlabelled control.
      await userEvent.click(screen.getByRole('radio', { name: /repeatedly/i }));
      await screen.findByLabelText('How often');
      await expectNoAxeViolations(container);
    });

    it('names every weekday checkbox, so the letters are decoration', async () => {
      /*
       * Requirement 10.2. The seven day boxes read "S M T W T F S" — two Ts and two Ss — so the letter
       * cannot be the accessible name. axe does not catch this: each box has *a* name, it is just an
       * ambiguous one, which is why this is asserted directly.
       */
      installSupabaseStub({
        session: makeSession(),
        tables: { profiles: [profileRow()], activities: [], activity_log: [] },
      });
      renderApp(<App />, { route: '/activities' });
      await userEvent.click(
        await screen.findByRole('button', { name: /add your first activity/i }),
      );

      for (const day of [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ]) {
        expect(screen.getByRole('checkbox', { name: day }), day).toBeInTheDocument();
      }
    });

    it('names each activity\u2019s controls, so a list of several is unambiguous', async () => {
      // "Log it" and "Delete" repeated down a list are useless to a screen reader without the activity
      // name attached, and axe reports nothing because each button does have a label.
      installSupabaseStub({
        session: makeSession(),
        tables: { profiles: [profileRow()], activities: [activityRow], activity_log: [] },
      });
      renderApp(<App />, { route: '/activities' });

      expect(await screen.findByRole('button', { name: 'Log Swim' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete Swim' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Remind me about Swim' })).toBeInTheDocument();
    });
  });
});

describe('signed-out screens', () => {
  it('sign in has no violations', async () => {
    installSupabaseStub({ session: null });
    const { container } = renderApp(<App />, { route: '/signin' });
    await screen.findByRole('heading', { level: 2, name: 'Sign in' });
    await expectNoAxeViolations(container);
  });

  it('the password reset form has no violations', async () => {
    installSupabaseStub({ session: null });
    const { container } = renderApp(<App />, { route: '/signin' });
    await userEvent.click(await screen.findByRole('button', { name: /forgotten your password/i }));
    await screen.findByRole('heading', { level: 2, name: /reset your password/i });
    await expectNoAxeViolations(container);
  });

  it('sign up has no violations', async () => {
    installSupabaseStub({ session: null });
    const { container } = renderApp(<App />, { route: '/signup' });
    await screen.findByRole('heading', { level: 2, name: 'Create your account' });
    await expectNoAxeViolations(container);
  });

  it('the check-your-inbox screen has no violations', async () => {
    installSupabaseStub({ session: null, signUpNeedsConfirmation: true });
    const { container } = renderApp(<App />, { route: '/signup' });

    await userEvent.type(await screen.findByLabelText('Your name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@fastr.test');
    await userEvent.type(screen.getByLabelText('Choose a password'), 'fastr-local-dev');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'fastr-local-dev');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await screen.findByRole('heading', { level: 2, name: 'Check your inbox' });
    await expectNoAxeViolations(container);
  });
});

describe('keyboard operation (Req 19.1)', () => {
  it('reaches the navigation and then the page content by tab alone', async () => {
    fullStub({ fasts: [activeFast] });
    renderApp(<App />, { route: '/' });
    await screen.findByText('4h 00m');

    // Walked rather than counted. Asserting "the sixth tab lands on the current page link" bakes in how many
    // focusable things happen to precede it, and that changes whenever a banner or a prompt appears.
    const visited: Element[] = [];
    for (let index = 0; index < 20; index += 1) {
      await userEvent.tab();
      if (document.activeElement && document.activeElement !== document.body) {
        visited.push(document.activeElement);
      }
    }

    // The skip link comes first, so a keyboard user is not walked through the navigation on every page.
    expect(visited[0]).toBe(screen.getByRole('link', { name: /skip to content/i }));

    // All five navigation links are reachable.
    const navLinks = screen.getAllByRole('link', { name: /timer|plans|history|stats|settings/i });
    for (const link of navLinks) expect(visited).toContain(link);

    // And focus carries on into the page rather than looping inside the navigation.
    expect(visited).toContain(screen.getByRole('button', { name: 'End fast' }));
  });

  it('keeps the plan cards operable from the keyboard', async () => {
    // They are buttons rather than divs with click handlers, which is what makes this true for free.
    renderApp(<App />, { route: '/plans' });
    const card = await screen.findByRole('button', { name: '16:8' });
    card.focus();
    expect(card).toHaveFocus();
  });
});
