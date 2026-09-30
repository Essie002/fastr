import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';

/**
 * jsdom setup for the web suites.
 *
 * Three shims below, each for something the app genuinely depends on and the test environment does not
 * provide: storage, the system colour preference, and connectivity.
 *
 * ## Storage
 *
 * `localStorage` is undefined here, and the reason is not jsdom. **Node 26 ships its own experimental
 * `localStorage` global**, which is inert unless the process is started with `--localstorage-file`, and
 * it shadows the one jsdom provides. Node says so itself, once per worker:
 *
 *     ExperimentalWarning: localStorage is not available because --localstorage-file was not provided
 *
 * Worth recording, because every obvious diagnosis is wrong: jsdom 30 driven directly with the same URL
 * returns a working `Storage`, the origin is not opaque, and `window` does carry an own property called
 * `localStorage` — it simply resolves to the Node global instead. Chasing it as a jsdom or origin
 * problem costs an hour.
 *
 * The alternative fix is passing `--localstorage-file` to the test runner, which makes the tests depend
 * on a Node flag and a scratch file on disk. A Map-backed `Storage` is smaller and has no filesystem in
 * it. Get, set, remove and clear over string keys is all Fastr asks of storage.
 */

/** A `Storage` implementation over a Map. Enough for what the app actually does with it. */
function createStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    // Coerced, because the real Storage stores strings and a test passing a number would otherwise
    // read back as a number here and as a string in a browser.
    setItem: (key: string, value: string) => {
      entries.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      entries.delete(String(key));
    },
    clear: () => {
      entries.clear();
    },
  } as Storage;
}

if (typeof window.localStorage === 'undefined') {
  const storage = createStorage();
  for (const target of [window, globalThis]) {
    Object.defineProperty(target, 'localStorage', {
      configurable: true,
      writable: true,
      value: storage,
    });
  }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  // jsdom has no matchMedia at all. A stub that reports "no preference" is the right default: it
  // means tests exercise the light theme unless they say otherwise, and it gives them a handle to
  // override when they want dark.
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
  }

  // jsdom reports navigator.onLine as true and has no way to change it, so the offline paths would
  // otherwise be untestable.
  //
  // The event matters as much as the flag. React Query keeps its own online state from `online` and
  // `offline` events and pauses fetches while it believes there is no network. Resetting the flag alone
  // leaves it paused for every later test in the file, and those tests fail with a screen that never
  // loads — nothing about which points at the test that went offline three cases earlier.
  Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: true });
  // Reset through React Query's own manager rather than by firing an `online` event: it only listens for
  // those events while a client is mounted, and between tests there is none, so an event is dropped and
  // it stays paused for the rest of the file.
  onlineManager.setOnline(true);

  window.localStorage?.clear();
  document.documentElement.removeAttribute('data-theme');
});

/** Makes `matchMedia('(prefers-color-scheme: dark)')` report a preference. */
export function setSystemDark(dark: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('dark') ? dark : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

/**
 * Flips connectivity for both things that track it: the app's own `useOnline`, which listens for the
 * events, and React Query, which keeps its own state and pauses fetches.
 */
export function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  onlineManager.setOnline(online);
}
