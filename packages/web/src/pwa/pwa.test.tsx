import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';
import { renderApp } from '../test/render.js';
import { setOnline } from '../test/setup.js';
import {
  clearSupabaseStub,
  installSupabaseStub,
  makeSession,
  profileRow,
} from '../test/supabaseStub.js';
import { detectPlatform } from './platform.js';

const publicDir = join(import.meta.dirname, '..', '..', 'public');

beforeEach(() => {
  installSupabaseStub({
    session: makeSession(),
    tables: { profiles: [profileRow()], fasts: [], water_entries: [] },
  });
});

afterEach(clearSupabaseStub);

describe('the manifest (Req 15.2)', () => {
  const manifest = JSON.parse(readFileSync(join(publicDir, 'manifest.webmanifest'), 'utf8'));

  it('is scoped relative to wherever it is served from', () => {
    /*
     * These were `/fastr/` until the app had to be served from the root of a Netlify domain as well as from a
     * subpath on Pages and in the container. A manifest is the one file that cannot read
     * `import.meta.env.BASE_URL` — it is static JSON, copied verbatim — so hardcoding either answer breaks the
     * other deployment, and the breakage is nasty: the browser silently refuses to install an app whose scope
     * does not contain its own start URL.
     *
     * Relative references solve it outright, because a manifest's URLs resolve against the manifest's own
     * location. Served at `/fastr/manifest.webmanifest`, "." is `/fastr/`; served at `/manifest.webmanifest`,
     * it is `/`. One file, correct at every base.
     */
    expect(manifest.scope).toBe('.');
    expect(manifest.start_url).toBe('.');
  });

  it('asks to open without browser chrome', () => {
    expect(manifest.display).toBe('standalone');
  });

  it('offers the icon sizes an installer needs, including a maskable one', () => {
    // Android crops icons to the launcher's shape, so an icon without safe-area padding gets its edges shaved.
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(
      true,
    );
  });

  it('references its icons relatively, so they resolve at any base', () => {
    // A leading slash is the failure this guards. "/icons/icon-192.png" resolves against the origin root, so on
    // Pages or in the container — where the app lives under /fastr/ — every icon 404s and the install prompt
    // never appears. There is nothing to see in the console; the prompt simply does not happen.
    for (const icon of manifest.icons as { src: string }[]) {
      expect(icon.src.startsWith('/'), `${icon.src} must not start with a slash`).toBe(false);
      expect(icon.src.startsWith('icons/')).toBe(true);
    }
  });

  it('resolves to the right place at both bases', () => {
    // The arithmetic the browser does, done here, because the reasoning above is only correct if this holds.
    for (const base of ['/fastr/', '/']) {
      const manifestUrl = new URL(`${base}manifest.webmanifest`, 'https://example.com');
      expect(new URL(manifest.start_url as string, manifestUrl).pathname).toBe(base);
      expect(new URL(manifest.scope as string, manifestUrl).pathname).toBe(base);
      expect(new URL((manifest.icons as { src: string }[])[0]!.src, manifestUrl).pathname).toBe(
        `${base}icons/icon-192.png`,
      );
    }
  });
});

describe('the service worker (Req 15.3)', () => {
  const worker = readFileSync(join(publicDir, 'service-worker.js'), 'utf8');

  it('never caches a non-GET request', () => {
    // Replaying a POST to Supabase would be worse than failing it.
    expect(worker).toMatch(/request\.method !== 'GET'/);
  });

  it('ignores cross-origin requests, so Supabase is never cached', () => {
    // Stale fasting data presented as current is worse than an error.
    expect(worker).toMatch(/url\.origin !== self\.location\.origin/);
  });

  it('serves the app shell network-first', () => {
    // A cached shell that never updates means running last month's JavaScript against this month's database.
    const fetchHandler = worker.slice(worker.indexOf("addEventListener('fetch'"));
    expect(fetchHandler).toMatch(/await fetch\(request\)/);
    expect(fetchHandler).toMatch(/catch/);
  });

  it('falls back to the shell for any navigation, since the router resolves the path', () => {
    expect(worker).toMatch(/request\.mode === 'navigate'/);
  });

  it('takes over immediately rather than waiting for every tab to close', () => {
    expect(worker).toMatch(/skipWaiting/);
    expect(worker).toMatch(/clients\.claim/);
  });

  it('deletes caches from older versions on activate', () => {
    expect(worker).toMatch(/caches\.delete/);
  });

  it('tags notifications so stage alerts replace one another', () => {
    // Without a tag, a 24-hour fast with stage alerts on produces six separate banners.
    expect(worker).toMatch(/tag: payload\.tag/);
  });

  it('focuses an open tab rather than opening a second one', () => {
    expect(worker).toMatch(/client\.focus\(\)/);
  });
});

describe('platform detection', () => {
  it('reports a plain desktop browser as installable and able to notify', () => {
    const platform = detectPlatform();
    expect(platform.isIos).toBe(false);
    expect(platform.needsInstallForPush).toBe(false);
  });

  it('spots an iPhone in a browser tab as needing installation first', () => {
    // The one case with no feature query: on iOS, push works only from an installed app, so the difference
    // between a useful instruction and a dead button is this detection.
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    });

    const platform = detectPlatform();
    expect(platform.isIos).toBe(true);
    expect(platform.needsInstallForPush).toBe(true);
  });

  it('treats an iPad reporting itself as a Mac as iOS', () => {
    // iPadOS 13+ claims to be a Macintosh; the touch points are what give it away.
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });

    expect(detectPlatform().isIos).toBe(true);

    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
  });
});

describe('the install prompt (Req 15.2)', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120',
    });
  });

  it('shows iPhone users how to add Fastr to the home screen', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    });

    renderApp(<App />, { route: '/' });

    expect(await screen.findByText(/add fastr to your home screen/i)).toBeInTheDocument();
    expect(screen.getByText(/share button/i)).toBeInTheDocument();
    // The reason it matters on this platform specifically.
    expect(
      screen.getByText(/notifications only work once fastr has been added/i),
    ).toBeInTheDocument();
  });

  it('can be dismissed for good', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    });

    renderApp(<App />, { route: '/' });
    await userEvent.click(await screen.findByRole('button', { name: /don't show this again/i }));

    await waitFor(() => {
      expect(screen.queryByText(/add fastr to your home screen/i)).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem('fastr.installDismissed')).toBe('true');
  });

  it('stays hidden on a browser that has not offered to install', async () => {
    // No beforeinstallprompt means either already installed or not eligible, and inventing a button for it
    // would do nothing when pressed.
    renderApp(<App />, { route: '/' });
    await screen.findByRole('heading', { name: /ready when you are/i });
    expect(screen.queryByText(/install fastr/i)).not.toBeInTheDocument();
  });
});

describe('offline behaviour (Req 15.4)', () => {
  it('keeps the timer running and says actions need a connection', async () => {
    const start = new Date(Date.now() - 4 * 3_600_000).toISOString();
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
            start_at: start,
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

    setOnline(false);

    // The timer is computed from the cached start time, so it carries on.
    expect(await screen.findByText(/you are offline/i)).toBeInTheDocument();
    expect(screen.getByText('4h 00m')).toBeInTheDocument();

    // Disabled rather than queued: a fast that silently ends hours later, when the network returns, is worse
    // than a button that says it cannot be used yet.
    expect(screen.getByRole('button', { name: 'End fast' })).toBeDisabled();
    expect(screen.getByText(/ending this fast needs a connection/i)).toBeInTheDocument();
  });

  it('disables starting a fast and explains why', async () => {
    renderApp(<App />, { route: '/' });
    await screen.findByRole('button', { name: 'Start fast' });

    setOnline(false);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start fast' })).toBeDisabled();
    });
    expect(
      screen.getByText(/needs a connection, so fastr can record when it began/i),
    ).toBeInTheDocument();
  });
});
