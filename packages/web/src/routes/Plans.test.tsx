import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PLANS } from '@fastr/shared';
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

function open(overrides: Record<string, unknown> = {}) {
  stub = installSupabaseStub({
    session: makeSession(),
    tables: { profiles: [profileRow(overrides)] },
  });
  return renderApp(<App />, { route: '/plans' });
}

beforeEach(() => {
  stub = installSupabaseStub({ session: makeSession(), tables: { profiles: [profileRow()] } });
});

afterEach(clearSupabaseStub);

describe('the catalog (Req 4.1, 4.2)', () => {
  it('lists every plan', async () => {
    open();
    await screen.findByRole('heading', { level: 1, name: 'Plans' });

    for (const plan of PLANS.filter((p) => !p.custom)) {
      expect(screen.getByRole('button', { name: new RegExp(plan.label, 'i') })).toBeInTheDocument();
    }
    // The custom plan is a form rather than a card, so it is checked by its own control.
    expect(screen.getByLabelText('Hours')).toBeInTheDocument();
  });

  it('shows the hours, the eating window and the difficulty for each', async () => {
    open();
    const card = await screen.findByRole('button', { name: /16:8/ });
    expect(card).toHaveTextContent('Fast 16h 00m');
    expect(card).toHaveTextContent('eat within 8h 00m');
    expect(card).toHaveTextContent('intermediate');
  });

  it('explains each plan in plain language rather than only naming it', async () => {
    open();
    const card = await screen.findByRole('button', { name: /16:8/ });
    expect(card).toHaveTextContent(/skipping breakfast/i);
  });

  it('marks the plans of 24 hours and over as extended (Req 4.3)', async () => {
    open();
    await screen.findByRole('heading', { level: 1, name: 'Plans' });

    expect(screen.getByRole('button', { name: /24 hours/ })).toHaveTextContent(/extended fast/i);
    expect(screen.getByRole('button', { name: /36 hours/ })).toHaveTextContent(/extended fast/i);
    expect(screen.getByRole('button', { name: /16:8/ })).not.toHaveTextContent(/extended fast/i);
  });
});

describe('choosing a plan (Req 4.4, 4.6)', () => {
  it('marks the current plan for assistive technology, not only in colour', async () => {
    open({ default_plan_id: '18:6' });
    const card = await screen.findByRole('button', { name: /18:6/ });
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(card).toHaveTextContent(/your plan/i);
  });

  it('saves the choice as the default', async () => {
    open({ default_plan_id: '16:8' });

    await userEvent.click(await screen.findByRole('button', { name: /20:4/ }));

    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith('profiles', {
        default_plan_id: '20:4',
        custom_goal_minutes: null,
      });
    });
  });

  it('clears any custom length when a fixed plan is chosen', async () => {
    // Otherwise a stale custom value sits on the profile and reappears if the custom plan is picked again.
    open({ default_plan_id: 'custom', custom_goal_minutes: 1035 });

    await userEvent.click(await screen.findByRole('button', { name: /16:8/ }));

    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith(
        'profiles',
        expect.objectContaining({ custom_goal_minutes: null }),
      );
    });
  });

  it('writes only to the profile, so a running fast is untouched (Req 4.6)', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /20:4/ }));

    await waitFor(() => expect(stub.calls.update).toHaveBeenCalled());
    for (const call of stub.calls.update.mock.calls) {
      expect(call[0]).toBe('profiles');
    }
  });
});

describe('the extended-fast notice (Req 4.3, 17.2)', () => {
  it('asks for confirmation before a 24-hour plan becomes the default', async () => {
    open();

    await userEvent.click(await screen.findByRole('button', { name: /24 hours/ }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/extended fast/i);
    // Nothing saved yet.
    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it('saves once confirmed', async () => {
    open();

    await userEvent.click(await screen.findByRole('button', { name: /36 hours/ }));
    await userEvent.click(await screen.findByRole('button', { name: /i understand/i }));

    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith('profiles', {
        default_plan_id: '36h',
        custom_goal_minutes: null,
      });
    });
  });

  it('saves nothing when cancelled', async () => {
    open();

    await userEvent.click(await screen.findByRole('button', { name: /24 hours/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it('does not appear for a plan under 24 hours', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /20:4/ }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('names the length and says to speak to a doctor', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /36 hours/ }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/36 hours/);
    expect(dialog).toHaveTextContent(/doctor/i);
  });
});

describe('the custom plan (Req 4.5)', () => {
  it('saves a valid length in minutes', async () => {
    open();

    await userEvent.type(await screen.findByLabelText('Hours'), '17.25');
    await userEvent.click(screen.getByRole('button', { name: /use this/i }));

    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith('profiles', {
        default_plan_id: 'custom',
        custom_goal_minutes: 1035,
      });
    });
  });

  it('refuses a length off a fifteen-minute step', async () => {
    open();

    await userEvent.type(await screen.findByLabelText('Hours'), '16.1');
    await userEvent.click(screen.getByRole('button', { name: /use this/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/steps of 15 minutes/i);
    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it('refuses a length over 72 hours', async () => {
    open();

    await userEvent.type(await screen.findByLabelText('Hours'), '80');
    await userEvent.click(screen.getByRole('button', { name: /use this/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/between 1 and 72 hours/i);
  });

  it('refuses a length under an hour', async () => {
    open();

    await userEvent.type(await screen.findByLabelText('Hours'), '0.5');
    await userEvent.click(screen.getByRole('button', { name: /use this/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it('asks for confirmation when the custom length is itself an extended fast', async () => {
    // The check has to be on the goal rather than on the plan: the custom plan is not marked extended,
    // but a 30-hour custom fast is.
    open();

    await userEvent.type(await screen.findByLabelText('Hours'), '30');
    await userEvent.click(screen.getByRole('button', { name: /use this/i }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/30 hours/);
    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it('shows the saved custom length', async () => {
    open({ default_plan_id: 'custom', custom_goal_minutes: 1035 });
    expect(await screen.findByText(/17h 15m/)).toBeInTheDocument();
  });
});
