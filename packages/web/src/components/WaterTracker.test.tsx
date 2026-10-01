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

let stub: Stub;

/** A water entry logged `hoursAgo` hours ago. */
function waterRow(id: string, ml: number, hoursAgo = 1) {
  return {
    id,
    user_id: '11111111-1111-4111-8111-111111111111',
    logged_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    ml,
  };
}

function open(options: { water?: unknown[]; profile?: Record<string, unknown> } = {}) {
  stub = installSupabaseStub({
    session: makeSession(),
    tables: {
      profiles: [profileRow(options.profile)],
      fasts: [],
      water_entries: options.water ?? [],
    },
  });
  return renderApp(<App />, { route: '/' });
}

beforeEach(() => {
  stub = installSupabaseStub({ session: makeSession(), tables: { profiles: [profileRow()] } });
});

afterEach(clearSupabaseStub);

describe('quick add (Req 12.1)', () => {
  it('offers amounts in millilitres for a millilitre user', async () => {
    open({ profile: { volume_unit: 'ml' } });

    expect(await screen.findByRole('button', { name: '+ 250 ml' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ 500 ml' })).toBeInTheDocument();
  });

  it('offers amounts in fluid ounces for a fluid-ounce user', async () => {
    // Offering "+250 ml" to someone working in fluid ounces is asking them to do arithmetic to log a glass.
    open({ profile: { volume_unit: 'floz' } });

    expect(await screen.findByRole('button', { name: '+ 8 fl oz' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ 16 fl oz' })).toBeInTheDocument();
  });

  it('logs the amount in millilitres', async () => {
    open({ profile: { volume_unit: 'ml' } });

    await userEvent.click(await screen.findByRole('button', { name: '+ 250 ml' }));

    await waitFor(() => {
      expect(stub.calls.insert).toHaveBeenCalledWith(
        'water_entries',
        expect.objectContaining({ ml: 250 }),
      );
    });
  });

  it('converts a fluid-ounce quick-add to millilitres', async () => {
    open({ profile: { volume_unit: 'floz' } });

    await userEvent.click(await screen.findByRole('button', { name: '+ 8 fl oz' }));

    await waitFor(() => {
      expect(stub.calls.insert).toHaveBeenCalledWith(
        'water_entries',
        expect.objectContaining({ ml: 237 }),
      );
    });
  });
});

describe('a custom amount (Req 12.1)', () => {
  it('logs it', async () => {
    open({ profile: { volume_unit: 'ml' } });

    await userEvent.type(await screen.findByLabelText(/another amount/i), '330');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(stub.calls.insert).toHaveBeenCalledWith(
        'water_entries',
        expect.objectContaining({ ml: 330 }),
      );
    });
  });

  it('refuses an empty amount', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/enter an amount/i);
    expect(stub.calls.insert).not.toHaveBeenCalled();
  });

  it('refuses more than one entry can hold, before the round trip', async () => {
    // The database caps a single entry at five litres.
    open({ profile: { volume_unit: 'ml' } });

    await userEvent.type(await screen.findByLabelText(/another amount/i), '6000');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/more than one entry can hold/i);
    expect(stub.calls.insert).not.toHaveBeenCalled();
  });
});

describe("today's total (Req 12.2, 12.4)", () => {
  it('adds up only today, in the user zone', async () => {
    open({ water: [waterRow('a', 250, 1), waterRow('b', 500, 2), waterRow('c', 400, 40)] });

    // 40 hours ago is not today in any zone, so 750 rather than 1150.
    expect(await screen.findByText(/750 ml of 2 L/)).toBeInTheDocument();
  });

  it('shows the total against the configured goal', async () => {
    open({ water: [waterRow('a', 250)], profile: { water_goal_ml: 3000 } });
    expect(await screen.findByText(/250 ml of 3 L/)).toBeInTheDocument();
  });

  it('exposes the progress to assistive technology as text, not as a bar width', async () => {
    open({ water: [waterRow('a', 250)] });

    // Waited on by its text first: the bar renders at zero before the entries arrive.
    await screen.findByText(/250 ml of 2 L/);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '250');
    expect(bar).toHaveAttribute('aria-valuetext', '250 ml of 2 L');
  });

  it('says when the goal is reached', async () => {
    open({ water: [waterRow('a', 2000)] });
    expect(await screen.findByText(/goal reached/i)).toBeInTheDocument();
  });

  it('converts the total for a fluid-ounce user', async () => {
    open({ water: [waterRow('a', 500)], profile: { volume_unit: 'floz' } });
    expect(await screen.findByText(/17 fl oz of 68 fl oz/)).toBeInTheDocument();
  });
});

describe('undo and delete (Req 12.3)', () => {
  it('offers to undo the most recent entry, naming its size', async () => {
    open({ water: [waterRow('a', 250, 1), waterRow('b', 500, 3)] });

    // Newest first, so the 250 logged an hour ago is the one to take back.
    expect(await screen.findByRole('button', { name: /undo 250 ml/i })).toBeInTheDocument();
  });

  it('deletes the entry it names', async () => {
    open({ water: [waterRow('a', 250, 1)] });

    await userEvent.click(await screen.findByRole('button', { name: /undo 250 ml/i }));

    await waitFor(() => expect(stub.calls.delete).toHaveBeenCalledWith('water_entries'));
  });

  it('names each delete button by its entry rather than repeating "Delete"', async () => {
    open({ water: [waterRow('a', 250, 1), waterRow('b', 500, 2)] });

    await userEvent.click(await screen.findByText(/today's 2 entries/i));

    expect(screen.getByRole('button', { name: /delete 250 ml logged at/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete 500 ml logged at/i })).toBeInTheDocument();
  });

  it('offers no undo when nothing has been logged today', async () => {
    open({ water: [] });
    await screen.findByRole('heading', { name: /water today/i });
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
  });
});

describe('the reflection prompt when ending a fast (Req 13.2)', () => {
  const activeFast = {
    id: 'fast-1',
    user_id: '11111111-1111-4111-8111-111111111111',
    plan_id: '16:8',
    goal_minutes: 960,
    start_at: new Date(Date.now() - 17 * 3_600_000).toISOString(),
    ended_at: null,
    status: 'active',
    mood: null,
    energy: null,
    note: null,
  };

  function openWithFast() {
    stub = installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()], fasts: [activeFast], water_entries: [] },
    });
    return renderApp(<App />, { route: '/' });
  }

  it('is offered as optional and collapsed', async () => {
    openWithFast();
    await userEvent.click(await screen.findByRole('button', { name: 'End fast' }));

    const summary = await screen.findByText(/how did it go\? \(optional\)/i);

    // Collapsed, so ending a fast stays one tap away rather than sitting behind a form. Asserted on the
    // `details` element rather than on the textarea's absence: a closed `details` still has its content in the
    // DOM, it is only hidden from view.
    expect(summary.closest('details')).not.toHaveAttribute('open');
  });

  it('can be skipped entirely', async () => {
    openWithFast();
    await userEvent.click(await screen.findByRole('button', { name: 'End fast' }));
    await userEvent.click(await screen.findByRole('button', { name: 'End fast' }));

    await waitFor(() => expect(stub.calls.update).toHaveBeenCalled());
    const patch = stub.calls.update.mock.calls[0]?.[1] as { mood: null; note: null };
    expect(patch.mood).toBeNull();
    expect(patch.note).toBeNull();
  });

  it('saves a mood and note when given', async () => {
    openWithFast();
    await userEvent.click(await screen.findByRole('button', { name: 'End fast' }));
    await userEvent.click(await screen.findByText(/how did it go/i));

    await userEvent.type(screen.getByLabelText('Notes'), 'Easier than usual');
    await userEvent.click(screen.getAllByRole('button', { name: 'End fast' })[0]!);

    await waitFor(() => expect(stub.calls.update).toHaveBeenCalled());
    expect((stub.calls.update.mock.calls[0]?.[1] as { note: string }).note).toBe(
      'Easier than usual',
    );
  });

  it('renders a note containing markup as text (Req 13.3)', async () => {
    openWithFast();
    await userEvent.click(await screen.findByRole('button', { name: 'End fast' }));
    await userEvent.click(await screen.findByText(/how did it go/i));

    const markup = '<img src=x onerror="alert(1)">';
    await userEvent.type(screen.getByLabelText('Notes'), markup);

    // React escapes it; the lint rule banning innerHTML and dangerouslySetInnerHTML is what keeps that true.
    expect(screen.getByLabelText('Notes')).toHaveValue(markup);
    expect(document.querySelector('img')).toBeNull();
  });
});
