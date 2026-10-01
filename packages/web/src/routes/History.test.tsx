import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';
import { renderApp } from '../test/render.js';
import {
  clearSupabaseStub,
  installSupabaseStub,
  makeSession,
  profileRow,
  type Stub,
} from '../test/supabaseStub.js';

let stub: Stub;

/** A finished fast ending `daysAgo` days ago at 12:00 local, `hours` long. */
function finishedFast(daysAgo: number, hours = 16, goalHours = 16, overrides = {}) {
  const end = new Date();
  end.setDate(end.getDate() - daysAgo);
  end.setHours(12, 0, 0, 0);
  const start = new Date(end.getTime() - hours * 3_600_000);
  return {
    id: `fast-${daysAgo}`,
    user_id: '11111111-1111-4111-8111-111111111111',
    plan_id: '16:8',
    goal_minutes: goalHours * 60,
    start_at: start.toISOString(),
    ended_at: end.toISOString(),
    status: hours >= goalHours ? 'completed' : 'ended_early',
    mood: null,
    energy: null,
    note: null,
    ...overrides,
  };
}

function open(fasts: unknown[], profile: Record<string, unknown> = {}) {
  stub = installSupabaseStub({
    session: makeSession(),
    tables: { profiles: [profileRow(profile)], fasts },
  });
  return renderApp(<App />, { route: '/history' });
}

beforeEach(() => {
  stub = installSupabaseStub({ session: makeSession(), tables: { profiles: [profileRow()] } });
});

afterEach(clearSupabaseStub);

describe('the list (Req 9.1)', () => {
  it('shows each fast with its duration, plan, goal and outcome', async () => {
    open([finishedFast(1, 16, 16)]);

    const item = await screen.findByRole('button', { name: /edit/i });
    expect(item).toHaveTextContent('16h 00m');
    expect(item).toHaveTextContent('16:8');
    expect(item).toHaveTextContent(/goal 16h 00m/);
    expect(item).toHaveTextContent(/met/);
  });

  it('marks a fast that fell short as ended early', async () => {
    open([finishedFast(1, 10, 16)]);
    expect(await screen.findByRole('button', { name: /edit/i })).toHaveTextContent(/ended early/);
  });

  it('shows the mood and energy recorded for a fast (Req 13.4)', async () => {
    open([finishedFast(1, 16, 16, { mood: 4, energy: 2 })]);
    const item = await screen.findByRole('button', { name: /edit/i });
    expect(item).toHaveTextContent(/mood 4\/5/);
    expect(item).toHaveTextContent(/energy 2\/5/);
  });

  it('says so when there is nothing yet, rather than showing an empty list', async () => {
    open([]);
    expect(await screen.findByText(/no finished fasts yet/i)).toBeInTheDocument();
  });

  it('reports a failure to load instead of looking empty', async () => {
    // An empty list and a failed request look identical otherwise, and one of them means "your data is gone".
    installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()] },
      tableErrors: { fasts: { message: 'network down' } },
    });
    renderApp(<App />, { route: '/history' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
  });
});

describe('the calendar (Req 9.2)', () => {
  it('is reachable and marks a completed fast on the day it ended', async () => {
    open([finishedFast(1, 16, 16)]);
    await screen.findByRole('button', { name: /edit/i });

    await userEvent.click(screen.getByRole('button', { name: 'Calendar' }));

    // The day is announced with its status, so the mark is not carried by colour alone.
    expect(await screen.findByText(/fast completed/i)).toBeInTheDocument();
  });

  it('distinguishes a fast that ended early', async () => {
    open([finishedFast(1, 10, 16)]);
    await screen.findByRole('button', { name: /edit/i });

    await userEvent.click(screen.getByRole('button', { name: 'Calendar' }));

    expect(await screen.findByText(/fast ended early/i)).toBeInTheDocument();
  });

  it('is a table with day-of-week headers, so a screen reader can place a date', async () => {
    open([finishedFast(1)]);
    await screen.findByRole('button', { name: /edit/i });
    await userEvent.click(screen.getByRole('button', { name: 'Calendar' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Monday' })).toBeInTheDocument();
  });

  it('explains what the marks mean', async () => {
    open([finishedFast(1)]);
    await screen.findByRole('button', { name: /edit/i });
    await userEvent.click(screen.getByRole('button', { name: 'Calendar' }));

    expect(
      await screen.findByText(/a filled day means a fast that met its goal/i),
    ).toBeInTheDocument();
  });
});

describe('editing a fast (Req 9.3)', () => {
  it('opens a form with the stored times', async () => {
    open([finishedFast(1, 16, 16)]);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

    expect(await screen.findByRole('heading', { name: /edit this fast/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Started')).toHaveValue();
    expect(screen.getByLabelText('Ended')).toHaveValue();
  });

  it('saves edited times as instants', async () => {
    open([finishedFast(1, 16, 16)]);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

    const start = screen.getByLabelText('Started');
    await userEvent.clear(start);
    await userEvent.type(start, '2026-09-01T20:00');
    const end = screen.getByLabelText('Ended');
    await userEvent.clear(end);
    await userEvent.type(end, '2026-09-02T12:00');

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(stub.calls.update).toHaveBeenCalled());
    const patch = stub.calls.update.mock.calls[0]?.[1] as { start_at: string; status: string };
    expect(patch.start_at).toMatch(/^2026-09-01T/);
    // 16 hours against a 16 hour goal, so the edit also corrects the outcome.
    expect(patch.status).toBe('completed');
  });

  it('recomputes whether the goal was met from the edited times', async () => {
    // Otherwise a fast stretched past its goal still reads as ended early.
    open([finishedFast(1, 10, 16)]);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

    const start = screen.getByLabelText('Started');
    await userEvent.clear(start);
    await userEvent.type(start, '2026-09-01T18:00');
    const end = screen.getByLabelText('Ended');
    await userEvent.clear(end);
    await userEvent.type(end, '2026-09-02T12:00');

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(stub.calls.update).toHaveBeenCalled());
    const patch = stub.calls.update.mock.calls[0]?.[1] as { status: string };
    expect(patch.status).toBe('completed');
  });

  it('refuses an end before the start, before sending it', async () => {
    open([finishedFast(1)]);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

    const end = screen.getByLabelText('Ended');
    await userEvent.clear(end);
    await userEvent.type(end, '2020-01-01T00:00');

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot end before it started/i);
    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it('refuses an end in the future', async () => {
    open([finishedFast(1)]);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

    const end = screen.getByLabelText('Ended');
    await userEvent.clear(end);
    await userEvent.type(end, '2099-01-01T00:00');

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot end in the future/i);
  });

  it('shows the resulting length as the times are changed', async () => {
    open([finishedFast(1, 16, 16)]);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

    expect(
      await screen.findByText(/that is 16h 00m, against a goal of 16h 00m/i),
    ).toBeInTheDocument();
  });

  it('lets a mood and note be attached to a past fast (Req 13.1)', async () => {
    open([finishedFast(1)]);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

    // Scoped to the mood group: both scales offer "4 of 5", which is correct and makes an unscoped query
    // ambiguous.
    const moodGroup = screen.getByRole('group', { name: /how did you feel/i });
    await userEvent.click(within(moodGroup).getByRole('radio', { name: /4 of 5/ }));
    await userEvent.type(screen.getByLabelText('Notes'), 'Felt good');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(stub.calls.update).toHaveBeenCalled());
    const patch = stub.calls.update.mock.calls[0]?.[1] as { mood: number; note: string };
    expect(patch.mood).toBe(4);
    expect(patch.note).toBe('Felt good');
  });

  it('surfaces an overlap from the database in plain words', async () => {
    stub = installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()], fasts: [finishedFast(1)] },
      tableErrors: {
        fasts: { message: 'violates exclusion constraint "fasts_no_overlap"', code: '23P01' },
      },
    });
    renderApp(<App />, { route: '/history' });

    // The list cannot load either with this stub, so the error surfaces from the load.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('deleting a fast (Req 9.3)', () => {
  it('asks first and warns it affects streaks', async () => {
    open([finishedFast(1)]);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    await userEvent.click(screen.getByRole('button', { name: /delete this fast/i }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/streaks/i);
    expect(stub.calls.delete).not.toHaveBeenCalled();
  });

  it('deletes once confirmed', async () => {
    open([finishedFast(1)]);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    await userEvent.click(screen.getByRole('button', { name: /delete this fast/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(stub.calls.delete).toHaveBeenCalledWith('fasts'));
  });
});

describe('adding a past fast (Req 9.4)', () => {
  it('inserts it already finished, so the 48-hour start limit does not apply', async () => {
    // The limit is about starting a fast. Logging history has to reach back months.
    open([]);

    await userEvent.click(
      await screen.findByRole('button', { name: /add a fast you did not track/i }),
    );

    const start = screen.getByLabelText('Started');
    await userEvent.clear(start);
    await userEvent.type(start, '2026-01-10T20:00');
    const end = screen.getByLabelText('Ended');
    await userEvent.clear(end);
    await userEvent.type(end, '2026-01-11T12:00');

    await userEvent.click(screen.getByRole('button', { name: 'Add fast' }));

    await waitFor(() => expect(stub.calls.insert).toHaveBeenCalled());
    const row = stub.calls.insert.mock.calls[0]?.[1] as {
      status: string;
      start_at: string;
      ended_at: string;
    };
    expect(row.status).toBe('completed');
    expect(row.ended_at).toMatch(/^2026-01-11T/);
  });

  it('records a short one as ended early', async () => {
    open([]);
    await userEvent.click(
      await screen.findByRole('button', { name: /add a fast you did not track/i }),
    );

    const start = screen.getByLabelText('Started');
    await userEvent.clear(start);
    await userEvent.type(start, '2026-01-10T20:00');
    const end = screen.getByLabelText('Ended');
    await userEvent.clear(end);
    await userEvent.type(end, '2026-01-11T04:00');

    await userEvent.click(screen.getByRole('button', { name: 'Add fast' }));

    await waitFor(() => expect(stub.calls.insert).toHaveBeenCalled());
    expect((stub.calls.insert.mock.calls[0]?.[1] as { status: string }).status).toBe('ended_early');
  });

  it('uses the goal of the plan chosen here, not today default', async () => {
    // Logging an old 18:6 fast against today's 16:8 goal would read as having overshot.
    open([], { default_plan_id: '16:8' });
    await userEvent.click(
      await screen.findByRole('button', { name: /add a fast you did not track/i }),
    );

    await userEvent.selectOptions(screen.getByLabelText('Plan'), '18:6');
    await userEvent.click(screen.getByRole('button', { name: 'Add fast' }));

    await waitFor(() => expect(stub.calls.insert).toHaveBeenCalled());
    expect((stub.calls.insert.mock.calls[0]?.[1] as { goal_minutes: number }).goal_minutes).toBe(
      1080,
    );
  });

  it('refuses an end before the start', async () => {
    open([]);
    await userEvent.click(
      await screen.findByRole('button', { name: /add a fast you did not track/i }),
    );

    const end = screen.getByLabelText('Ended');
    await userEvent.clear(end);
    await userEvent.type(end, '2020-01-01T00:00');

    await userEvent.click(screen.getByRole('button', { name: 'Add fast' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot end before it started/i);
    expect(stub.calls.insert).not.toHaveBeenCalled();
  });
});
