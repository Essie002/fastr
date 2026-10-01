import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
import { recordServerTime, resetClockOffset } from '../time/clock.js';

let stub: Stub;

/** An active fast that started `hoursAgo` hours ago. */
function activeFast(hoursAgo: number, goalMinutes = 960) {
  return {
    id: 'fast-1',
    user_id: '11111111-1111-4111-8111-111111111111',
    plan_id: '16:8',
    goal_minutes: goalMinutes,
    start_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    ended_at: null,
    status: 'active',
    mood: null,
    energy: null,
    note: null,
  };
}

function open(options: { fasts?: unknown[]; profile?: Record<string, unknown> } = {}) {
  stub = installSupabaseStub({
    session: makeSession(),
    tables: { profiles: [profileRow(options.profile)], fasts: options.fasts ?? [] },
  });
  return renderApp(<App />, { route: '/' });
}

beforeEach(() => {
  resetClockOffset();
  stub = installSupabaseStub({ session: makeSession(), tables: { profiles: [profileRow()] } });
});

afterEach(() => {
  clearSupabaseStub();
  resetClockOffset();
});

describe('with no fast running', () => {
  it('offers to start one, naming the plan and its length', async () => {
    open({ profile: { default_plan_id: '16:8' } });

    expect(await screen.findByRole('heading', { name: /ready when you are/i })).toBeInTheDocument();
    expect(screen.getByText(/your plan is 16:8/i)).toBeInTheDocument();
    expect(screen.getByText(/fast 16h 00m/i)).toBeInTheDocument();
  });

  it('starts a fast with the profile plan and goal (Req 5.1)', async () => {
    open({ profile: { default_plan_id: '18:6' } });

    await userEvent.click(await screen.findByRole('button', { name: 'Start fast' }));

    await waitFor(() => {
      expect(stub.calls.insert).toHaveBeenCalledWith(
        'fasts',
        expect.objectContaining({ plan_id: '18:6', goal_minutes: 1080, status: 'active' }),
      );
    });
  });

  it('uses the custom length when the custom plan is selected', async () => {
    open({ profile: { default_plan_id: 'custom', custom_goal_minutes: 1035 } });

    await userEvent.click(await screen.findByRole('button', { name: 'Start fast' }));

    await waitFor(() => {
      expect(stub.calls.insert).toHaveBeenCalledWith(
        'fasts',
        expect.objectContaining({ goal_minutes: 1035 }),
      );
    });
  });
});

describe('backdating a start (Req 5.3)', () => {
  it('sends a start time in the past', async () => {
    open();

    await userEvent.click(await screen.findByRole('button', { name: /i started earlier/i }));
    await userEvent.type(screen.getByLabelText(/how many hours ago/i), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Start fast' }));

    await waitFor(() => expect(stub.calls.insert).toHaveBeenCalled());
    const row = stub.calls.insert.mock.calls[0]?.[1] as { start_at: string };
    const hoursAgo = (Date.now() - Date.parse(row.start_at)) / 3_600_000;
    expect(hoursAgo).toBeCloseTo(10, 1);
  });

  it('refuses more than 48 hours before sending it', async () => {
    // Caught here so the message is about the rule rather than about a database trigger.
    open();

    await userEvent.click(await screen.findByRole('button', { name: /i started earlier/i }));
    await userEvent.type(screen.getByLabelText(/how many hours ago/i), '60');
    await userEvent.click(screen.getByRole('button', { name: 'Start fast' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/more than 48 hours ago/i);
    expect(stub.calls.insert).not.toHaveBeenCalled();
  });

  it('refuses a non-numeric answer', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /i started earlier/i }));
    await userEvent.type(screen.getByLabelText(/how many hours ago/i), '-');
    await userEvent.click(screen.getByRole('button', { name: 'Start fast' }));

    expect(stub.calls.insert).not.toHaveBeenCalled();
  });
});

describe('starting an extended fast (Req 17.2)', () => {
  it('asks for confirmation even though the plan was chosen earlier', async () => {
    open({ profile: { default_plan_id: '36h' } });

    await userEvent.click(await screen.findByRole('button', { name: 'Start fast' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/extended fast/i);
    expect(stub.calls.insert).not.toHaveBeenCalled();
  });

  it('starts once confirmed', async () => {
    open({ profile: { default_plan_id: '24h' } });

    await userEvent.click(await screen.findByRole('button', { name: 'Start fast' }));
    await userEvent.click(await screen.findByRole('button', { name: /i understand/i }));

    await waitFor(() => expect(stub.calls.insert).toHaveBeenCalled());
  });
});

describe('while a fast is running (Req 5.4, 5.7)', () => {
  it('shows elapsed and remaining time from the stored start', async () => {
    open({ fasts: [activeFast(4)] });

    expect(await screen.findByText('4h 00m')).toBeInTheDocument();
    expect(screen.getByText(/12h 00m to go/)).toBeInTheDocument();
  });

  it('shows the current stage and the next one', async () => {
    // Four hours in: past "blood sugar falling" at 2h, before "normal" at 5h.
    open({ fasts: [activeFast(4)] });

    expect(await screen.findByRole('heading', { name: 'Blood sugar falling' })).toBeInTheDocument();
    expect(screen.getByText(/next: blood sugar normal in 1h 00m/i)).toBeInTheDocument();
  });

  it('keeps counting past the goal rather than stopping (Req 5.7)', async () => {
    open({ fasts: [activeFast(18)] });

    expect(await screen.findByText('18h 00m')).toBeInTheDocument();
    expect(screen.getByText(/2h 00m past your goal/)).toBeInTheDocument();
  });

  it('is correct after a remount, because nothing is accumulated (Req 5.5)', async () => {
    const first = open({ fasts: [activeFast(9)] });
    expect(await screen.findByText('9h 00m')).toBeInTheDocument();
    first.unmount();

    open({ fasts: [activeFast(9)] });
    expect(await screen.findByText('9h 00m')).toBeInTheDocument();
  });

  it('applies the clock offset, so a wrong device clock does not skew it (Req 5.5)', async () => {
    // The fast started 4 hours ago by the server's clock, and this device is an hour behind.
    recordServerTime(new Date(Date.now() + 60 * 60_000));
    open({ fasts: [activeFast(4)] });

    expect(await screen.findByText('5h 00m')).toBeInTheDocument();
  });

  it('offers the whole state as text for a screen reader', async () => {
    open({ fasts: [activeFast(4)] });

    expect(await screen.findByText(/fasting for 4h 00m of a 16h 00m goal/i)).toBeInTheDocument();
  });

  it('announces the stage politely rather than every second', async () => {
    open({ fasts: [activeFast(4)] });

    const region = await screen.findByText(/stage reached: blood sugar falling/i);
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('announces the goal once reached', async () => {
    open({ fasts: [activeFast(17)] });
    expect(await screen.findByText(/goal reached/i)).toBeInTheDocument();
  });

  it('hides the ticking numbers from assistive technology', async () => {
    // A live region updating every second would talk continuously and never finish a sentence.
    open({ fasts: [activeFast(4)] });
    const elapsed = await screen.findByText('4h 00m');
    expect(elapsed).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('ending a fast (Req 5.8)', () => {
  it('asks for confirmation first', async () => {
    open({ fasts: [activeFast(17)] });

    await userEvent.click(await screen.findByRole('button', { name: 'End fast' }));

    // Named, because the goal alert is also an alertdialog on a fast that has passed its goal.
    expect(await screen.findByRole('alertdialog', { name: /end this fast/i })).toBeInTheDocument();
    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it('records a fast that met its goal as completed', async () => {
    open({ fasts: [activeFast(17)] });

    await userEvent.click(await screen.findByRole('button', { name: 'End fast' }));
    await userEvent.click(await screen.findByRole('button', { name: 'End fast' }));

    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith(
        'fasts',
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });

  it('records a short fast as ended early, and says so before saving', async () => {
    open({ fasts: [activeFast(10)] });

    await userEvent.click(await screen.findByRole('button', { name: 'End fast' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/6h 00m short of your goal/i);

    await userEvent.click(screen.getByRole('button', { name: 'End fast' }));
    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith(
        'fasts',
        expect.objectContaining({ status: 'ended_early' }),
      );
    });
  });

  it('can be backed out of', async () => {
    open({ fasts: [activeFast(10)] });

    await userEvent.click(await screen.findByRole('button', { name: 'End fast' }));
    await userEvent.click(await screen.findByRole('button', { name: /keep fasting/i }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(stub.calls.update).not.toHaveBeenCalled();
  });
});

describe('discarding a fast (Req 5.10)', () => {
  it('deletes it rather than recording it as ended early', async () => {
    open({ fasts: [activeFast(3)] });

    await userEvent.click(
      await screen.findByRole('button', { name: /discard without recording/i }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(stub.calls.delete).toHaveBeenCalledWith('fasts'));
    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it('warns that it cannot be undone', async () => {
    open({ fasts: [activeFast(3)] });
    await userEvent.click(
      await screen.findByRole('button', { name: /discard without recording/i }),
    );
    expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument();
  });
});

describe('the three-day prompt (Req 17.4)', () => {
  it('appears past 72 hours', async () => {
    open({ fasts: [activeFast(73, 72 * 60)] });
    expect(await screen.findByText(/over three days/i)).toBeInTheDocument();
  });

  it('does not appear before then', async () => {
    open({ fasts: [activeFast(20, 72 * 60)] });
    await screen.findByText('20h 00m');
    expect(screen.queryByText(/over three days/i)).not.toBeInTheDocument();
  });
});

describe('database errors', () => {
  it('explains an overlap in words a person can act on', async () => {
    stub = installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()], fasts: [] },
      tableErrors: {
        fasts: {
          message: 'conflicting key value violates exclusion constraint "fasts_no_overlap"',
          code: '23P01',
        },
      },
    });
    renderApp(<App />, { route: '/' });

    await userEvent.click(await screen.findByRole('button', { name: 'Start fast' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/overlaps a fast you have already/i);
  });
});
