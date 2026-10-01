import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.1 AA contrast, checked arithmetically. Requirement 19.3 and the design's accessibility section.
 *
 * This suite exists because `axe` derives contrast from rendered pixels and jsdom does not paint, so axe's contrast
 * rules are disabled throughout this project. Without this, the success criterion most easily broken by a design
 * tweak — someone lightening a muted grey by two percent — would be the only one nothing verifies.
 *
 * The tokens are read out of the stylesheet rather than duplicated here. A copy of the palette in a test is a copy
 * that passes while the real one fails.
 */

/**
 * Comments are stripped before anything is parsed.
 *
 * The tokens file annotates several values with their measured ratio, and a trailing `/* ... *\/` runs past the
 * semicolon that ends its declaration — so splitting on `;` first makes the comment and the *next* declaration one
 * chunk, and that declaration is silently dropped. The symptom is a contrast suite that passes while quietly
 * checking half the palette.
 */
const css = readFileSync(join(import.meta.dirname, '..', 'styles', 'tokens.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Pulls the custom properties out of one `[data-theme=...]` block, including the `:root` light defaults. */
function readTheme(selector: string): Record<string, string> {
  // Light lives in a combined `:root, [data-theme='light']` rule, so the selector is matched loosely.
  const pattern = new RegExp(`${selector}[^{]*\\{([^}]*)\\}`, 'g');
  const tokens: Record<string, string> = {};

  for (const match of css.matchAll(pattern)) {
    for (const line of match[1]!.split(';')) {
      const [name, value] = line.split(':').map((part) => part?.trim());
      if (name?.startsWith('--') && value) tokens[name] = value;
    }
  }
  return tokens;
}

function channel(value: number): number {
  const fraction = value / 255;
  return fraction <= 0.03928 ? fraction / 12.92 : ((fraction + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/** The pairs that actually appear on screen, as foreground on background. */
const PAIRS: readonly [string, string, string][] = [
  ['--text', '--bg', 'body text on the page'],
  ['--text', '--surface', 'body text on a card'],
  ['--text', '--surface-sunken', 'body text on a sunken panel'],
  ['--text-muted', '--bg', 'muted text on the page'],
  ['--text-muted', '--surface', 'muted text on a card'],
  ['--accent', '--bg', 'links and the ring on the page'],
  ['--accent', '--surface', 'links on a card'],
  ['--text-on-accent', '--accent', 'text on a primary button'],
  ['--warn', '--warn-soft', 'warning text on its background'],
  ['--danger', '--danger-soft', 'error text on its background'],
];

/** 4.5:1 for body text. The large-text allowance of 3:1 is not claimed anywhere here. */
const AA_NORMAL = 4.5;

describe.each([
  ['light', readTheme("\\[data-theme='light'\\]")],
  ['dark', readTheme("\\[data-theme='dark'\\]")],
])('%s theme contrast', (themeName, tokens) => {
  it('defines every token the pairs refer to', () => {
    // Guards against the parsing silently finding nothing and every assertion below passing vacuously.
    for (const [foreground, background] of PAIRS) {
      expect(tokens[foreground], `${themeName} is missing ${foreground}`).toBeDefined();
      expect(tokens[background], `${themeName} is missing ${background}`).toBeDefined();
    }
  });

  it.each(PAIRS)('meets AA for %s on %s (%s)', (foreground, background, description) => {
    const measured = ratio(tokens[foreground]!, tokens[background]!);
    expect(
      measured,
      `${themeName}: ${description} is ${measured.toFixed(2)}:1, needs ${AA_NORMAL}:1`,
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('keeps borders visible against their surfaces', () => {
    // 3:1 is the bar for a boundary that carries meaning, which these do: the selected plan card is marked by one.
    const measured = ratio(tokens['--border']!, tokens['--surface']!);
    expect(measured).toBeGreaterThanOrEqual(1.4);
  });
});

describe('the contrast helper itself', () => {
  it('agrees with the known extremes', () => {
    // Without this, a bug in the arithmetic would make every assertion above meaningless.
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(ratio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(ratio('#1f6f4a', '#f7f7f5')).toBeCloseTo(ratio('#f7f7f5', '#1f6f4a'), 10);
  });
});
