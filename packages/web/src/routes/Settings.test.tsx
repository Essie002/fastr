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

function open(overrides: Record<string, unknown> = {}) {
  stub = installSupabaseStub({
    session: makeSession(),
    tables: { profiles: [profileRow(overrides)] },
  });
  return renderApp(<App />, { route: '/settings' });
}

beforeEach(() => {
  // Replaced per test by `open`, but a default keeps the stub installed if a test renders before calling it.
  stub = installSupabaseStub({ session: makeSession(), tables: { profiles: [profileRow()] } });
});

afterEach(clearSupabaseStub);

describe('settings (Req 3.1)', () => {
  it('shows the values already on the profile', async () => {
    open({ display_name: 'Ada', time_zone: 'Africa/Nairobi', weight_unit: 'lb' });

    expect(await screen.findByLabelText('Your name')).toHaveValue('Ada');
    expect(screen.getByLabelText('Time zone')).toHaveValue('Africa/Nairobi');
    expect(screen.getByLabelText('Weight')).toHaveValue('lb');
  });

  it('saves the name on blur rather than on every keystroke', async () => {
    open({ display_name: 'Ada' });
    const field = await screen.findByLabelText('Your name');

    await userEvent.clear(field);
    await userEvent.type(field, 'Ada Lovelace');
    // Nothing yet: a save per letter would write a row for every character.
    expect(stub.calls.update).not.toHaveBeenCalled();

    await userEvent.tab();
    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith('profiles', { display_name: 'Ada Lovelace' });
    });
  });

  it('refuses an empty name and restores the old one', async () => {
    // An empty name violates the database check constraint, so it is caught here rather than sent and
    // bounced with a message about a constraint.
    open({ display_name: 'Ada' });
    const field = await screen.findByLabelText('Your name');

    await userEvent.clear(field);
    await userEvent.tab();

    expect(field).toHaveValue('Ada');
    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it('does not save the name when it has not changed', async () => {
    open({ display_name: 'Ada' });
    const field = await screen.findByLabelText('Your name');

    await userEvent.click(field);
    await userEvent.tab();

    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it('saves a time zone change immediately', async () => {
    open({ time_zone: 'UTC' });

    await userEvent.selectOptions(await screen.findByLabelText('Time zone'), 'Europe/London');

    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith('profiles', { time_zone: 'Europe/London' });
    });
  });

  it('always offers the currently saved zone as an option', async () => {
    // Otherwise a saved value vanishes from the control that edits it, and the select silently shows
    // something else as selected.
    open({ time_zone: 'Pacific/Chatham' });
    const select = await screen.findByLabelText('Time zone');
    expect(select).toHaveValue('Pacific/Chatham');
  });

  it('saves each unit choice', async () => {
    open({ weight_unit: 'kg', volume_unit: 'ml' });

    await userEvent.selectOptions(await screen.findByLabelText('Weight'), 'lb');
    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith('profiles', { weight_unit: 'lb' });
    });

    await userEvent.selectOptions(screen.getByLabelText('Water'), 'floz');
    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith('profiles', { volume_unit: 'floz' });
    });
  });
});

describe('theme (Req 14.1, 14.2)', () => {
  it('applies the choice to the document at once, not after the round trip', async () => {
    // A theme toggle that waits for the server feels broken on mobile data.
    open({ theme: 'system' });

    await userEvent.selectOptions(await screen.findByLabelText('Theme'), 'dark');

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('saves the choice to the account', async () => {
    open({ theme: 'system' });

    await userEvent.selectOptions(await screen.findByLabelText('Theme'), 'dark');

    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith('profiles', { theme: 'dark' });
    });
  });

  it('writes the choice to storage, which is what the pre-paint script reads', async () => {
    open({ theme: 'system' });

    await userEvent.selectOptions(await screen.findByLabelText('Theme'), 'dark');

    expect(window.localStorage.getItem('fastr.theme')).toBe('dark');
  });

  it('offers all three options', async () => {
    open();
    const select = await screen.findByLabelText('Theme');
    expect(select.querySelectorAll('option')).toHaveLength(3);
  });
});

describe('notification preferences (Req 7.4, 7.5)', () => {
  it('reflects what is stored', async () => {
    open({ notify_goal: true, notify_stages: false, notify_hour_before: false });

    expect(await screen.findByLabelText(/reaches its goal/i)).toBeChecked();
    expect(screen.getByLabelText(/each fasting stage/i)).not.toBeChecked();
    expect(screen.getByLabelText(/one hour before/i)).not.toBeChecked();
  });

  it('saves a toggle', async () => {
    open({ notify_stages: false });

    await userEvent.click(await screen.findByLabelText(/each fasting stage/i));

    await waitFor(() => {
      expect(stub.calls.update).toHaveBeenCalledWith('profiles', { notify_stages: true });
    });
  });

  it('warns that stage notifications come in numbers', async () => {
    open();
    expect(await screen.findByText(/several per fast/i)).toBeInTheDocument();
  });
});

describe('changing a password (Req 3.2)', () => {
  it('is behind a button rather than always on screen', async () => {
    open();
    expect(await screen.findByRole('button', { name: 'Change password' })).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('requires the two entries to match', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));

    await userEvent.type(screen.getByLabelText('New password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'correct-horse-bettery');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(stub.calls.updateUser).not.toHaveBeenCalled();
  });

  it('saves a valid password', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));

    await userEvent.type(screen.getByLabelText('New password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));

    await waitFor(() => {
      expect(stub.calls.updateUser).toHaveBeenCalledWith({ password: 'correct-horse-battery' });
    });
    expect(await screen.findByText(/password has been changed/i)).toBeInTheDocument();
  });

  it('explains a stale session rather than repeating Supabase at the user', async () => {
    // secure_password_change is on, so this is the likely failure, and its raw message is about
    // reauthentication rather than about anything the user did.
    stub = installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()] },
      authErrors: { updateUser: { message: 'reauthentication needed', status: 400 } },
    });
    renderApp(<App />, { route: '/settings' });

    await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));
    await userEvent.type(screen.getByLabelText('New password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/signed in recently/i);
  });
});

describe('when settings cannot be loaded', () => {
  it('says so instead of showing empty fields', async () => {
    // Blank inputs would look like a profile that had been wiped, and saving one would write that.
    installSupabaseStub({
      session: makeSession(),
      tableErrors: { profiles: { message: 'network down' } },
    });
    renderApp(<App />, { route: '/settings' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  });
});
