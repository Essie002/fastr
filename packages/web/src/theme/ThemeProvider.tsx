import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Theme } from '@fastr/shared';
import { applyTheme, readStoredTheme, resolveTheme, storeTheme } from './theme.js';

/**
 * Holds the user's theme choice and keeps the document in step with it.
 *
 * The initial value comes from `localStorage`, not from the profile, because the document has already
 * been painted by `public/theme-boot.js` using that same value and disagreeing with it here would
 * cause the flash Requirement 14.2 forbids. The profile is the source of truth across devices, so
 * `setTheme` is called once after sign-in with whatever the account holds; if that differs, the
 * correction is a single change right after sign-in rather than on every load.
 */

interface ThemeContextValue {
  /** What the user chose, which may be 'system'. */
  choice: Theme;
  /** What that currently resolves to. What the document is actually painted in. */
  resolved: 'light' | 'dark';
  setTheme: (choice: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<Theme>(() => readStoredTheme());
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );

  // Following the system preference means following it while the app is open, not only at load: a
  // phone switching to dark mode at sunset should take the app with it.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(choice, systemDark);

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setTheme = useCallback((next: Theme) => {
    setChoice(next);
    // Written immediately, so the boot script paints correctly on the next load even if the profile
    // update that follows fails or the app is closed before it completes.
    storeTheme(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, resolved, setTheme }),
    [choice, resolved, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('useTheme must be used inside a ThemeProvider.');
  return value;
}
