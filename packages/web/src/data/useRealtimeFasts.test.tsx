import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { App } from '../App.js';
import { renderApp } from '../test/render.js';
import {
  clearSupabaseStub,
  installSupabaseStub,
  makeSession,
  profileRow,
} from '../test/supabaseStub.js';

afterEach(clearSupabaseStub);

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

describe('staying in step with other devices (Req 5.6)', () => {
  it('refetches when a change arrives from elsewhere', async () => {
    const stub = installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()], fasts: [activeFast] },
    });
    renderApp(<App />, { route: '/' });

    await screen.findByText('4h 00m');
    const before = stub.reads.get('fasts') ?? 0;

    stub.emitRealtimeChange();

    // Invalidated rather than patched from the payload: merging state twice, once for fetches and once for
    // events, guarantees the two paths disagree eventually.
    await waitFor(() => {
      expect(stub.reads.get('fasts') ?? 0).toBeGreaterThan(before);
    });
  });

  it('says so when the channel is down, without implying the app is broken', async () => {
    installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()], fasts: [activeFast] },
      realtimeStatus: 'CHANNEL_ERROR',
    });
    renderApp(<App />, { route: '/' });

    expect(await screen.findByText(/live updates are unavailable/i)).toBeInTheDocument();
    // The timer still works, which is the point of the wording.
    expect(await screen.findByText('4h 00m')).toBeInTheDocument();
  });

  it('stays quiet while the channel is healthy', async () => {
    installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()], fasts: [activeFast] },
      realtimeStatus: 'SUBSCRIBED',
    });
    renderApp(<App />, { route: '/' });

    await screen.findByText('4h 00m');
    expect(screen.queryByText(/live updates are unavailable/i)).not.toBeInTheDocument();
  });

  it('does not stack a realtime warning on top of the offline banner', async () => {
    // Offline, the banner already explains it. Two messages about one cause read as two faults.
    const { setOnline } = await import('../test/setup.js');
    installSupabaseStub({
      session: makeSession(),
      tables: { profiles: [profileRow()], fasts: [activeFast] },
      realtimeStatus: 'CHANNEL_ERROR',
    });
    renderApp(<App />, { route: '/' });
    await screen.findByText(/live updates are unavailable/i);

    setOnline(false);

    await waitFor(() => {
      expect(screen.queryByText(/live updates are unavailable/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/you are offline/i)).toBeInTheDocument();
  });
});
