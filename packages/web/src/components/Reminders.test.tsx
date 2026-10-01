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
import { describeWeekdays } from '../data/reminders.js';

let stub: Stub;

function open(reminders: unknown[] = []) {
  stub = installSupabaseStub({
    session: makeSession(),
    tables: {
      profiles: [profileRow()],
      fasts: [],
      water_entries: [],
      push_subscriptions: [],
      reminders,
    },
  });
  return renderApp(<App />, { route: '/settings' });
}

beforeEach(() => {
  stub = installSupabaseStub({ session: makeSession(), tables: { profiles: [profileRow()] } });
});

afterEach(clearSupabaseStub);

describe('describeWeekdays', () => {
  it('names the common patterns rather than listing seven days', () => {
    expect(describeWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(describeWeekdays([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(describeWeekdays([0, 6])).toBe('Weekends');
  });

  it('lists an unusual selection', () => {
    expect(describeWeekdays([1, 3])).toBe('Monday, Wednesday');
  });

  it('does not depend on the order given', () => {
    expect(describeWeekdays([5, 1, 3])).toBe('Monday, Wednesday, Friday');
  });
});

describe('reminders (Req 8.1)', () => {
  it('creates one with a time and the chosen days', async () => {
    open();

    await screen.findByRole('heading', { name: 'Reminders' });
    // Monday to Friday is the default selection, so only the time needs setting.
    await userEvent.click(screen.getByRole('button', { name: /add reminder/i }));

    await waitFor(() => {
      expect(stub.calls.insert).toHaveBeenCalledWith(
        'reminders',
        expect.objectContaining({ local_time: '20:00', weekdays: [1, 2, 3, 4, 5], enabled: true }),
      );
    });
  });

  it('refuses an empty day selection before sending it', async () => {
    // The database refuses an empty array; catching it here produces a message about the rule rather than a
    // constraint name.
    open();
    await screen.findByRole('heading', { name: 'Reminders' });

    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      await userEvent.click(screen.getByRole('checkbox', { name: day }));
    }
    await userEvent.click(screen.getByRole('button', { name: /add reminder/i }));

    expect(await screen.findByText(/pick at least one day/i)).toBeInTheDocument();
    expect(stub.calls.insert).not.toHaveBeenCalled();
  });

  it('lists existing reminders in words', async () => {
    open([
      {
        id: 'r1',
        user_id: '11111111-1111-4111-8111-111111111111',
        local_time: '20:00:00',
        weekdays: [1, 2, 3, 4, 5],
        enabled: true,
      },
    ]);

    expect(await screen.findByText('20:00')).toBeInTheDocument();
    expect(screen.getByText('Weekdays')).toBeInTheDocument();
  });

  it('names its switch and its delete button per reminder', async () => {
    // Several reminders otherwise present identical "On" switches and "Delete" buttons.
    open([
      {
        id: 'r1',
        user_id: '11111111-1111-4111-8111-111111111111',
        local_time: '20:00:00',
        weekdays: [1, 2, 3, 4, 5],
        enabled: true,
      },
    ]);

    expect(
      await screen.findByRole('checkbox', { name: /enable the 20:00 reminder on weekdays/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete the 20:00 reminder/i })).toBeInTheDocument();
  });

  it('can be switched off without being deleted', async () => {
    open([
      {
        id: 'r1',
        user_id: '11111111-1111-4111-8111-111111111111',
        local_time: '20:00:00',
        weekdays: [1],
        enabled: true,
      },
    ]);

    await userEvent.click(
      await screen.findByRole('checkbox', { name: /enable the 20:00 reminder/i }),
    );

    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith('reminders', { enabled: false });
    });
    expect(stub.calls.delete).not.toHaveBeenCalled();
  });

  it('says reminders are skipped while a fast is running', async () => {
    open();
    expect(
      await screen.findByText(/skipped automatically when a fast is already running/i),
    ).toBeInTheDocument();
  });
});
