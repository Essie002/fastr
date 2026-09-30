import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_COLORS, THEME_STORAGE_KEY } from './theme.js';

/**
 * The boot script and the React theme module have to agree.
 *
 * `public/theme-boot.js` runs before the module graph loads — that is its entire purpose — so it cannot
 * import `theme.ts`. The storage key, the accepted values and the two chrome colours therefore exist
 * twice, and nothing in the type system connects them. If they drift, the app paints one theme before
 * React starts and a different one after, which is exactly the flash Requirement 14.2 forbids, and it
 * would appear only on a real page load where no component test would catch it.
 *
 * So this suite reads the script as text and asserts the shared values appear in it. Crude, and it is
 * the only thing holding the two halves together.
 */

const script = readFileSync(
  join(import.meta.dirname, '..', '..', 'public', 'theme-boot.js'),
  'utf8',
);

describe('public/theme-boot.js', () => {
  it('uses the same storage key as the React side', () => {
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it('uses the same chrome colours', () => {
    expect(script).toContain(THEME_COLORS.dark);
    expect(script).toContain(THEME_COLORS.light);
  });

  it('recognises all three stored values', () => {
    for (const value of ['light', 'dark', 'system']) {
      expect(script).toContain(`'${value}'`);
    }
  });

  it('resolves the system preference with the same media query', () => {
    expect(script).toContain('prefers-color-scheme: dark');
  });

  it('writes the theme onto the document element', () => {
    expect(script).toMatch(/documentElement\.setAttribute\(\s*'data-theme'/);
  });

  it('survives localStorage throwing', () => {
    // Safari in private mode throws on read. Failing to paint is worse than ignoring the stored value.
    expect(script).toMatch(/try\s*{[\s\S]*localStorage[\s\S]*}\s*catch/);
  });

  it('stays free of imports, so it can run before the module graph', () => {
    expect(script).not.toMatch(/\bimport\b/);
    expect(script).not.toMatch(/\brequire\(/);
  });
});
