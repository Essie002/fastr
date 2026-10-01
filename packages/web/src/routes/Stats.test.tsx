import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { currentStreak, longestStreak, stats as computeStats } from '@fastr/shared';
import type { CompletedFast } from '@fastr/shared';
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

/** A completed fast ending `daysAgo` days ago at noon, `hours` long against a `goalHours` goal. */
function fastRow(daysAgo: number, hours = 16, goalHours = 16) {
  const end = new Date();
  end.setDate(end.getDate() - daysAgo);
  end.setHours(12, 0, 0, 0);
  return {
    id: `fast-${daysAgo}`,
    user_id: '11111111-1111-4111-8111-111111111111',
    plan_id: '16:8',
    goal_minutes: goalHours * 60,
    start_at: new Date(end.getTime() - hours * 3_600_000).toISOString(),
    ended_at: end.toISOString(),
    status: hours >= goalHours ? 'completed' : 'ended_early',
    mood: null,
    energy: null,
    note: null,
  };
}

function weightRow(daysAgo: number, grams: number) {
  const day = new Date();
  day.setDate(day.getDate() - daysAgo);
  return {
    id: `weight-${daysAgo}`,
    user_id: '11111111-1111-4111-8111-111111111111',
    measured_on: day.toISOString().slice(0, 10),
    grams,
  };
}

function open(
  options: { fasts?: unknown[]; weights?: unknown[]; profile?: Record<string, unknown> } = {},
) {
  stub = installSupabaseStub({
    session: makeSession(),
    tables: {
      profiles: [profileRow(options.profile)],
      fasts: options.fasts ?? [],
      weight_entries: options.weights ?? [],
    },
  });
  return renderApp(<App />, { route: '/stats' });
}

beforeEach(() => {
  stub = installSupabaseStub({ session: makeSession(), tables: { profiles: [profileRow()] } });
});

afterEach(clearSupabaseStub);

describe('streaks (Req 10.1, 10.2)', () => {
  it('counts consecutive days ending today', async () => {
    open({ fasts: [fastRow(0), fastRow(1), fastRow(2)] });

    const section = await screen.findByRole('region', { name: 'Streaks' });
    expect(within(section).getByText('Current streak').nextSibling).toHaveTextContent('3 days');
  });

  it('agrees with the shared functions on the same data', async () => {
    // The arithmetic is property-tested in the shared package. What matters here is that the screen shows the
    // same answer rather than a second implementation of it.
    const rows = [fastRow(0), fastRow(1), fastRow(3)];
    open({ fasts: rows });

    const fasts: CompletedFast[] = rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      planId: row.plan_id,
      goalMinutes: row.goal_minutes,
      startAt: row.start_at,
      endedAt: row.ended_at,
      status: row.status as 'completed',
      mood: null,
      energy: null,
      note: null,
    }));

    const section = await screen.findByRole('region', { name: 'Streaks' });
    const expectedCurrent = currentStreak(fasts, 'Africa/Nairobi', new Date());
    const expectedLongest = longestStreak(fasts, 'Africa/Nairobi');

    expect(within(section).getByText('Current streak').nextSibling).toHaveTextContent(
      `${expectedCurrent} day`,
    );
    expect(within(section).getByText('Longest streak').nextSibling).toHaveTextContent(
      `${expectedLongest} day`,
    );
  });

  it('uses the singular for one day', async () => {
    open({ fasts: [fastRow(0)] });
    const section = await screen.findByRole('region', { name: 'Streaks' });
    expect(within(section).getByText('Current streak').nextSibling).toHaveTextContent('1 day');
  });

  it('reads zero with no qualifying fasts', async () => {
    open({ fasts: [fastRow(0, 8, 16)] });
    const section = await screen.findByRole('region', { name: 'Streaks' });
    expect(within(section).getByText('Current streak').nextSibling).toHaveTextContent('0 days');
  });

  it('explains what counts', async () => {
    open({ fasts: [fastRow(0)] });
    expect(
      await screen.findByText(/a day counts when a fast that met its goal ended on it/i),
    ).toBeInTheDocument();
  });
});

describe('fasting figures (Req 10.4)', () => {
  it('shows the figures the requirement names', async () => {
    open({ fasts: [fastRow(1, 16), fastRow(2, 18)] });

    const section = await screen.findByRole('region', { name: 'Fasting' });
    expect(within(section).getByText('Fasts completed')).toBeInTheDocument();
    expect(within(section).getByText('Average, last 7 days')).toBeInTheDocument();
    expect(within(section).getByText('Average, last 30 days')).toBeInTheDocument();
    expect(within(section).getByText('Longest fast')).toBeInTheDocument();
    expect(within(section).getByText('Goals met')).toBeInTheDocument();
  });

  it('agrees with the shared stats function', async () => {
    const rows = [fastRow(1, 16), fastRow(2, 20), fastRow(3, 10, 16)];
    open({ fasts: rows });

    const fasts = rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      planId: row.plan_id,
      goalMinutes: row.goal_minutes,
      startAt: row.start_at,
      endedAt: row.ended_at,
      status: row.status as 'completed',
      mood: null,
      energy: null,
      note: null,
    }));
    const expected = computeStats(fasts, new Date());

    const section = await screen.findByRole('region', { name: 'Fasting' });
    expect(within(section).getByText('Longest fast').nextSibling).toHaveTextContent('20h 00m');
    expect(within(section).getByText('Goals met').nextSibling).toHaveTextContent(
      `${Math.round(expected.goalCompletionRate! * 100)}%`,
    );
  });

  it('says "no data yet" rather than zero when there is nothing', async () => {
    // "0h average" is a claim about your fasting. "No data yet" is the truth.
    open({ fasts: [] });
    const section = await screen.findByRole('region', { name: 'Fasting' });
    expect(within(section).getByText('Longest fast').nextSibling).toHaveTextContent('No data yet');
  });
});

describe('weight (Req 11)', () => {
  it('logs a weight in the chosen unit, stored as grams', async () => {
    open({ profile: { weight_unit: 'kg' } });

    await userEvent.type(await screen.findByLabelText(/weight \(kg\)/i), '72.5');
    await userEvent.click(screen.getByRole('button', { name: /log weight/i }));

    await waitFor(() => expect(stub.calls.insert).toHaveBeenCalled());
    expect((stub.calls.insert.mock.calls[0]?.[1] as { grams: number }).grams).toBe(72_500);
  });

  it('converts pounds on the way in', async () => {
    open({ profile: { weight_unit: 'lb' } });

    await userEvent.type(await screen.findByLabelText(/weight \(lb\)/i), '160');
    await userEvent.click(screen.getByRole('button', { name: /log weight/i }));

    await waitFor(() => expect(stub.calls.insert).toHaveBeenCalled());
    expect((stub.calls.insert.mock.calls[0]?.[1] as { grams: number }).grams).toBe(72_575);
  });

  it('refuses an empty weight', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /log weight/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/enter your weight/i);
    expect(stub.calls.insert).not.toHaveBeenCalled();
  });

  it('explains a weight outside the accepted range', async () => {
    stub = installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()], fasts: [], weight_entries: [] },
      tableErrors: {
        weight_entries: { message: 'violates check constraint "weight_entries_grams_check"' },
      },
    });
    renderApp(<App />, { route: '/stats' });

    await userEvent.type(await screen.findByLabelText(/weight \(kg\)/i), '500');
    await userEvent.click(screen.getByRole('button', { name: /log weight/i }));

    // This stub also fails the weight *read*, so the load error is on screen too. The save error is the one
    // being asserted.
    expect(await screen.findByText(/20 to 400 kg/i)).toBeInTheDocument();
  });

  it('offers the chart as a table for screen readers (Req 11.5)', async () => {
    open({ weights: [weightRow(2, 72_000), weightRow(1, 71_800)] });

    expect(await screen.findByText(/all 2 readings as a table/i)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /weight readings/i })).toBeInTheDocument();
  });

  it('states the trend in words, which a table cannot convey', async () => {
    open({ weights: [weightRow(30, 74_000), weightRow(1, 72_000)] });
    expect(await screen.findByText(/down 2.0 kg since/i)).toBeInTheDocument();
  });

  it('says when a flat series has not changed', async () => {
    open({ weights: [weightRow(10, 72_000), weightRow(1, 72_000)] });
    expect(await screen.findByText(/unchanged over this period/i)).toBeInTheDocument();
  });

  it('hides the drawing from assistive technology, since the table carries the data', async () => {
    open({ weights: [weightRow(1, 72_000)] });
    await screen.findByText(/readings as a table/i);
    // Queried by class rather than by role, because an aria-hidden SVG deliberately has no role to find.
    const svg = document.querySelector('.chart__svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('filters by the chosen period', async () => {
    open({ weights: [weightRow(200, 75_000), weightRow(1, 72_000)] });

    await userEvent.click(await screen.findByRole('button', { name: '30 days' }));

    expect(await screen.findByText(/all 1 readings as a table/i)).toBeInTheDocument();
  });

  it('names each delete button by its entry', async () => {
    // Ten identical "Delete" buttons are unusable with a screen reader.
    open({ weights: [weightRow(1, 72_000)] });
    expect(
      await screen.findByRole('button', { name: /delete the reading from/i }),
    ).toBeInTheDocument();
  });

  it('deletes an entry', async () => {
    open({ weights: [weightRow(1, 72_000)] });
    await userEvent.click(await screen.findByRole('button', { name: /delete the reading from/i }));
    await waitFor(() => expect(stub.calls.delete).toHaveBeenCalledWith('weight_entries'));
  });

  it('invites a first reading rather than showing an empty chart', async () => {
    open({ weights: [] });
    expect(await screen.findByText(/no weights logged for this period/i)).toBeInTheDocument();
  });
});
