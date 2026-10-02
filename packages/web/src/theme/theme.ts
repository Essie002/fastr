import type { Theme } from '@fastr/shared';

/**
 * Theme resolution, shared by React and mirrored by `public/theme-boot.js`.
 *
 * The boot script cannot import this: it runs before the module graph loads, which is the whole point
 * of it. So the storage key and the resolution rule exist twice, and `themeBoot.test.ts` reads the
 * boot script and asserts both halves agree. That test is the only thing standing between this and a
 * theme that flashes the wrong colour after some future edit.
 */

export const THEME_STORAGE_KEY = 'fastr.theme';

/**
 * The two colours the browser paints outside the app: status bar, overscroll.
 *
 * These are a third copy of `--bg` from `styles/tokens.css`, which the stylesheet cannot hand to
 * JavaScript before paint. `themeBoot.test.ts` reads the stylesheet and asserts all three agree.
 */
export const THEME_COLORS = { light: '#fdf2e6', dark: '#241033' } as const;

export type ResolvedTheme = 'light' | 'dark';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function prefersDark(): boolean {
  // Guarded for jsdom, where matchMedia exists but has no preference, and for old Safari.
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

export function resolveTheme(choice: Theme, systemPrefersDark = prefersDark()): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}

export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    // Private mode throws rather than returning null.
    return 'system';
  }
}

export function storeTheme(choice: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // A theme that does not persist is a smaller problem than a crash on a settings page.
  }
}

/** Applies a resolved theme to the document. The single place that touches `data-theme`. */
export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[resolved]);
}
