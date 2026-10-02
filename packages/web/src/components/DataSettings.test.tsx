import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { fastsToCsv } from '../data/exportData.js';
import type { FastrExport } from '@fastr/shared';

let stub: Stub;

function open(options: { functionErrors?: Record<string, string> } = {}) {
  stub = installSupabaseStub({
    session: makeSession(),
    tables: {
      profiles: [profileRow()],
      fasts: [],
      weight_entries: [],
      water_entries: [],
      day_notes: [],
      reminders: [],
      push_subscriptions: [],
    },
    ...(options.functionErrors ? { functionErrors: options.functionErrors } : {}),
  });
  return renderApp(<App />, { route: '/settings' });
}

beforeEach(() => {
  // jsdom has neither, and the export path uses both.
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  stub = installSupabaseStub({ session: makeSession(), tables: { profiles: [profileRow()] } });
});

afterEach(() => {
  clearSupabaseStub();
  vi.restoreAllMocks();
});

const emptyExport: FastrExport = {
  version: 1,
  exportedAt: '2026-09-30T00:00:00.000Z',
  profile: {},
  fasts: [],
  weightEntries: [],
  waterEntries: [],
  dayNotes: [],
  reminders: [],
  activities: [],
  activityLog: [],
};

describe('CSV export (Req 16.1)', () => {
  it('writes a header and one row per finished fast', () => {
    const csv = fastsToCsv({
      ...emptyExport,
      fasts: [
        {
          planId: '16:8',
          goalMinutes: 960,
          startAt: '2026-09-01T20:00:00.000Z',
          endedAt: '2026-09-02T12:00:00.000Z',
          status: 'completed',
          mood: 4,
          energy: 3,
          note: 'Fine',
        },
      ],
    });

    const lines = csv.split('\n');
    expect(lines[0]).toContain('started_at');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('16:8');
    // 16 hours against a 16 hour goal.
    expect(lines[1]).toContain('960,960,yes');
  });

  it('leaves out a fast that has not finished', () => {
    const csv = fastsToCsv({
      ...emptyExport,
      fasts: [
        {
          planId: '16:8',
          goalMinutes: 960,
          startAt: '2026-09-01T20:00:00.000Z',
          endedAt: null,
          status: 'active',
          mood: null,
          energy: null,
          note: null,
        },
      ],
    });
    expect(csv.split('\n')).toHaveLength(1);
  });

  it('quotes a note containing a comma or a newline', () => {
    // An unescaped newline silently splits one fast across two rows.
    const csv = fastsToCsv({
      ...emptyExport,
      fasts: [
        {
          planId: '16:8',
          goalMinutes: 960,
          startAt: '2026-09-01T20:00:00.000Z',
          endedAt: '2026-09-02T12:00:00.000Z',
          status: 'completed',
          mood: null,
          energy: null,
          note: 'Tired, but fine\nslept badly',
        },
      ],
    });
    expect(csv).toContain('"Tired, but fine\nslept badly"');
    expect(csv.split('\n')).toHaveLength(3); // header + a row broken by the quoted newline
  });

  it('neutralises a note that a spreadsheet would treat as a formula', () => {
    // CSV injection: a note beginning "=" becomes an executable cell in Excel, and these notes are user-written.
    const csv = fastsToCsv({
      ...emptyExport,
      fasts: [
        {
          planId: '16:8',
          goalMinutes: 960,
          startAt: '2026-09-01T20:00:00.000Z',
          endedAt: '2026-09-02T12:00:00.000Z',
          status: 'completed',
          mood: null,
          energy: null,
          note: '=HYPERLINK("http://evil.test")',
        },
      ],
    });
    expect(csv).toContain("'=HYPERLINK");
  });
});

describe('the export controls (Req 16.1)', () => {
  it('offers JSON for round-tripping and CSV for a spreadsheet', async () => {
    open();
    expect(
      await screen.findByRole('button', { name: /download everything \(json\)/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download fasts \(csv\)/i })).toBeInTheDocument();
  });

  it('explains why keeping a copy matters here specifically', async () => {
    open();
    expect(await screen.findByText(/pauses after a week of inactivity/i)).toBeInTheDocument();
  });

  it('produces a download', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /download everything/i }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(await screen.findByText(/download should be starting/i)).toBeInTheDocument();
  });
});

describe('import (Req 16.3)', () => {
  it('rejects a file that is not a Fastr export, before sending it', async () => {
    open();

    const input = await screen.findByLabelText(/import a fastr export/i);
    await userEvent.upload(
      input,
      new File([JSON.stringify({ hello: 'world' })], 'wrong.json', { type: 'application/json' }),
    );

    expect(await screen.findByText(/does not look like a fastr export/i)).toBeInTheDocument();
    expect(stub.calls.invoke).not.toHaveBeenCalled();
  });

  it('sends a valid export to the import function', async () => {
    open();

    const input = await screen.findByLabelText(/import a fastr export/i);
    await userEvent.upload(
      input,
      new File([JSON.stringify(emptyExport)], 'fastr.json', { type: 'application/json' }),
    );

    await waitFor(() =>
      expect(stub.calls.invoke).toHaveBeenCalledWith('import-data', expect.anything()),
    );
    expect(await screen.findByText(/imported/i)).toBeInTheDocument();
  });

  it('reports a refusal without claiming anything changed', async () => {
    open({ functionErrors: { 'import-data': 'account already has fasts' } });

    const input = await screen.findByLabelText(/import a fastr export/i);
    await userEvent.upload(
      input,
      new File([JSON.stringify(emptyExport)], 'fastr.json', { type: 'application/json' }),
    );

    expect(await screen.findByText(/nothing was changed/i)).toBeInTheDocument();
  });

  it('says it only works into an empty account', async () => {
    open();
    expect(await screen.findByText(/only into an empty account/i)).toBeInTheDocument();
  });
});

describe('deleting the account (Req 3.3)', () => {
  it('is behind a typed phrase, not just a second button', async () => {
    open();

    await userEvent.click(await screen.findByRole('button', { name: /delete my account/i }));

    const confirm = await screen.findByRole('button', { name: 'Delete my account' });
    // Two taps is not enough friction for something irreversible.
    expect(confirm).toBeDisabled();
  });

  it('warns what will be lost and suggests exporting first', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /delete my account/i }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    expect(dialog).toHaveTextContent(/download your data first/i);
  });

  it('enables the button only on the exact phrase', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /delete my account/i }));

    const field = await screen.findByLabelText(/type .* to confirm/i);
    await userEvent.type(field, 'delete');
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, 'delete my account');
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeEnabled();
  });

  it('calls the function with no user id in the body', async () => {
    // The function takes the id from the verified token. Sending one would invite the habit of trusting it.
    open();
    await userEvent.click(await screen.findByRole('button', { name: /delete my account/i }));
    await userEvent.type(await screen.findByLabelText(/type .* to confirm/i), 'delete my account');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    await waitFor(() => expect(stub.calls.invoke).toHaveBeenCalledWith('delete-account', {}));
  });

  it('can be cancelled', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /delete my account/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(stub.calls.invoke).not.toHaveBeenCalled();
  });
});
