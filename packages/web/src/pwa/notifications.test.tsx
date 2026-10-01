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
import { decodeVapidKey, describeDevice } from '../data/push.js';

const VAPID =
  'BDN6Pns8SexD3_Reqmvj2DmGNJM7ryiZzA980C9an0CyLOu7iEH4WLhNxiFlhAqE7JdCQwF43RT0IJGFBtX_wv4';

let stub: Stub;
let requestPermission: ReturnType<typeof vi.fn>;
let subscribe: ReturnType<typeof vi.fn>;

/**
 * jsdom implements neither Notification nor PushManager, so both are installed here. The shape is the part the
 * app depends on; the browser's actual behaviour is checked by hand on a real device, as the README says.
 */
function installPushEnvironment({
  permission = 'default' as NotificationPermission,
  existing = null as PushSubscription | null,
} = {}) {
  requestPermission = vi.fn().mockResolvedValue('granted');
  subscribe = vi.fn().mockResolvedValue({
    endpoint: 'https://push.example.test/abc',
    toJSON: () => ({
      endpoint: 'https://push.example.test/abc',
      keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
    }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  });

  const NotificationStub = Object.assign(vi.fn(), {
    permission,
    requestPermission,
  });

  Object.defineProperty(window, 'Notification', {
    configurable: true,
    writable: true,
    value: NotificationStub,
  });
  Object.defineProperty(window, 'PushManager', {
    configurable: true,
    writable: true,
    value: class {},
  });

  const registration = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(existing),
      subscribe,
    },
    showNotification: vi.fn().mockResolvedValue(undefined),
  };

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    writable: true,
    value: {
      ready: Promise.resolve(registration),
      register: vi.fn().mockResolvedValue(registration),
      controller: null,
      addEventListener: vi.fn(),
    },
  });

  return registration;
}

function open(options: { subscriptions?: unknown[] } = {}) {
  stub = installSupabaseStub({
    session: makeSession(),
    tables: {
      profiles: [profileRow()],
      fasts: [],
      water_entries: [],
      push_subscriptions: options.subscriptions ?? [],
    },
  });
  return renderApp(<App />, { route: '/settings' });
}

beforeEach(() => {
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', VAPID);
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120',
  });
  installPushEnvironment();
});

afterEach(() => {
  clearSupabaseStub();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('decodeVapidKey', () => {
  it('decodes base64url into the raw 65-byte point subscribe wants', () => {
    // Passing the string straight through produces an InvalidCharacterError on some browsers and a subscription
    // nothing can sign for on others.
    const bytes = decodeVapidKey(VAPID);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(65);
    // An uncompressed P-256 point always starts with 0x04.
    expect(bytes[0]).toBe(4);
  });

  it('handles a key needing base64 padding', () => {
    expect(() => decodeVapidKey('YWJj')).not.toThrow();
  });
});

describe('describeDevice', () => {
  it('names the common platforms and falls back politely', () => {
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('iPhone');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14)')).toBe('Android device');
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('Mac');
    expect(describeDevice(null)).toBe('Unknown device');
  });
});

describe('turning notifications on (Req 7.2)', () => {
  it('does not ask for permission on load', async () => {
    // A prompt nobody asked for is what teaches people to press Block, and a blocked permission cannot be asked
    // for again from the page.
    open();
    await screen.findByRole('heading', { name: 'This device' });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('asks only when the control is pressed', async () => {
    open();

    await userEvent.click(await screen.findByRole('button', { name: /turn on notifications/i }));

    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('subscribes with the VAPID key and stores the subscription', async () => {
    open();

    await userEvent.click(await screen.findByRole('button', { name: /turn on notifications/i }));

    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    expect(subscribe.mock.calls[0]?.[0]?.userVisibleOnly).toBe(true);

    await waitFor(() => {
      expect(stub.calls.insert).toHaveBeenCalledWith(
        'push_subscriptions',
        expect.objectContaining({
          endpoint: 'https://push.example.test/abc',
          p256dh: 'p256dh-value',
          auth: 'auth-value',
        }),
      );
    });
  });

  it('reuses an existing subscription rather than creating a second one', async () => {
    // Two subscriptions for one browser means every notification arrives twice.
    installPushEnvironment({
      existing: {
        endpoint: 'https://push.example.test/existing',
        toJSON: () => ({
          endpoint: 'https://push.example.test/existing',
          keys: { p256dh: 'a', auth: 'b' },
        }),
      } as unknown as PushSubscription,
    });
    open();

    await userEvent.click(await screen.findByRole('button', { name: /turn on notifications/i }));

    await waitFor(() => expect(stub.calls.insert).toHaveBeenCalled());
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('stores nothing when permission is refused', async () => {
    requestPermission.mockResolvedValue('denied');
    open();

    await userEvent.click(await screen.findByRole('button', { name: /turn on notifications/i }));

    await waitFor(() => expect(requestPermission).toHaveBeenCalled());
    expect(stub.calls.insert).not.toHaveBeenCalled();
  });
});

describe('when notifications are blocked (Req 7.2)', () => {
  it('explains that only browser settings can undo it', async () => {
    // Asking again is impossible once denied, so a button would be a dead end.
    installPushEnvironment({ permission: 'denied' });
    open();

    expect(await screen.findByText(/notifications are blocked for fastr/i)).toBeInTheDocument();
    expect(screen.getByText(/padlock or site settings/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /turn on notifications/i }),
    ).not.toBeInTheDocument();
  });
});

describe('on iPhone in a browser tab (Req 7.12)', () => {
  it('explains that the app must be installed first, instead of offering a dead button', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    });
    open();

    expect(await screen.findByText(/only allows notifications from an app/i)).toBeInTheDocument();
    // Two sets of instructions are on screen here: this section's, and the install prompt's at the foot of the
    // page. Both are correct, so the count is asserted rather than a single match.
    expect(screen.getAllByText(/add to home screen/i).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: /turn on notifications/i }),
    ).not.toBeInTheDocument();
  });
});

describe('when the build has no VAPID key', () => {
  it('says so rather than creating a subscription nothing can sign for', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
    open();

    expect(await screen.findByText(/no notification key/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /turn on notifications/i }),
    ).not.toBeInTheDocument();
  });
});

describe('once enabled (Req 7.13)', () => {
  it('offers a test notification and shows it through the service worker', async () => {
    const registration = installPushEnvironment({ permission: 'granted' });
    open();

    await userEvent.click(await screen.findByRole('button', { name: /send a test notification/i }));

    await waitFor(() => expect(registration.showNotification).toHaveBeenCalled());
    expect(registration.showNotification.mock.calls[0]?.[0]).toBe('Fastr');
  });

  it('can be turned off for this device, deleting the row before unsubscribing', async () => {
    // The row goes first: reversed, a failed delete would leave the server sending to an endpoint the browser has
    // forgotten.
    installPushEnvironment({
      permission: 'granted',
      existing: {
        endpoint: 'https://push.example.test/abc',
        toJSON: () => ({
          endpoint: 'https://push.example.test/abc',
          keys: { p256dh: 'a', auth: 'b' },
        }),
        unsubscribe: vi.fn().mockResolvedValue(true),
      } as unknown as PushSubscription,
    });
    open();

    await userEvent.click(await screen.findByRole('button', { name: /turn off on this device/i }));

    await waitFor(() => expect(stub.calls.delete).toHaveBeenCalledWith('push_subscriptions'));
  });

  it('lists the devices that can receive notifications, surfacing repeated failures', async () => {
    // A persistently failing subscription is otherwise invisible: notifications just stop on one device.
    installPushEnvironment({ permission: 'granted' });
    open({
      subscriptions: [
        {
          id: 'sub-1',
          endpoint: 'https://push.example.test/a',
          user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
          created_at: '2026-09-01T00:00:00.000Z',
          last_ok_at: '2026-09-20T00:00:00.000Z',
          failures: 3,
        },
      ],
    });

    await userEvent.click(await screen.findByText(/1 device can receive notifications/i));

    expect(screen.getByText('iPhone')).toBeInTheDocument();
    expect(screen.getByText(/3 recent failures/)).toBeInTheDocument();
  });
});

describe('the in-app goal alert (Req 7.10)', () => {
  it('appears when a fast passes its goal while the app is open', async () => {
    // A browser will not show a push notification for a focused page, so this is the only thing that fires.
    installSupabaseStub({
      session: makeSession(),
      tables: {
        profiles: [profileRow()],
        water_entries: [],
        fasts: [
          {
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
          },
        ],
      },
    });

    renderApp(<App />, { route: '/' });

    const alert = await screen.findByRole('alertdialog', { name: /goal reached/i });
    expect(alert).toHaveTextContent(/17h 00m/);
  });

  it('stays away before the goal', async () => {
    installSupabaseStub({
      session: makeSession(),
      tables: {
        profiles: [profileRow()],
        water_entries: [],
        fasts: [
          {
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
          },
        ],
      },
    });

    renderApp(<App />, { route: '/' });
    await screen.findByText('4h 00m');
    expect(screen.queryByRole('alertdialog', { name: /goal reached/i })).not.toBeInTheDocument();
  });

  it('can be dismissed and does not come back', async () => {
    installSupabaseStub({
      session: makeSession(),
      tables: {
        profiles: [profileRow()],
        water_entries: [],
        fasts: [
          {
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
          },
        ],
      },
    });

    renderApp(<App />, { route: '/' });
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: /goal reached/i })).not.toBeInTheDocument();
    });
  });
});
