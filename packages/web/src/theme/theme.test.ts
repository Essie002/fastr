import { describe, expect, it } from 'vitest';
import {
  THEME_COLORS,
  THEME_STORAGE_KEY,
  applyTheme,
  isTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
} from './theme.js';

describe('resolveTheme', () => {
  it('passes an explicit choice straight through', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the system preference when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('isTheme', () => {
  it('accepts the three valid values and nothing else', () => {
    expect(['light', 'dark', 'system'].every(isTheme)).toBe(true);
    expect(isTheme('midnight')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});

describe('stored theme', () => {
  it('round-trips a choice', () => {
    storeTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readStoredTheme()).toBe('dark');
  });

  it('falls back to system when nothing is stored', () => {
    expect(readStoredTheme()).toBe('system');
  });

  it('falls back to system when the stored value is nonsense', () => {
    // Someone editing localStorage, or a value left by an older version of the app.
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(readStoredTheme()).toBe('system');
  });
});

describe('applyTheme', () => {
  it('sets data-theme on the document', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('keeps the browser chrome colour in step', () => {
    // Without this, a dark app sits under a light status bar on an installed PWA.
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.append(meta);

    applyTheme('dark');
    expect(meta.getAttribute('content')).toBe(THEME_COLORS.dark);

    applyTheme('light');
    expect(meta.getAttribute('content')).toBe(THEME_COLORS.light);

    meta.remove();
  });

  it('does not throw when there is no theme-color meta tag', () => {
    expect(() => applyTheme('dark')).not.toThrow();
  });
});
