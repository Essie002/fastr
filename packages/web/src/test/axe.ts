import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe over a rendered container and fails with the violations spelled out.
 *
 * Two rule groups are turned off, and both deserve a reason rather than a shrug.
 *
 * **Colour contrast.** axe derives contrast from rendered pixels, and jsdom paints nothing, so these rules either
 * error or pass vacuously. Contrast is checked arithmetically instead, in `theme/contrast.test.ts`, against the
 * tokens as they are actually written.
 *
 * **Region.** This rule wants every piece of content inside a landmark. Components are rendered here in isolation,
 * without the app shell that provides `main`, so it would fire on every component test for a problem that does not
 * exist in the app. The whole-app tests do include the shell.
 */
const DISABLED = new Set(['color-contrast', 'color-contrast-enhanced', 'region']);

export async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: Object.fromEntries([...DISABLED].map((rule) => [rule, { enabled: false }])),
    // The rule sets Fastr is held to. WCAG 2.1 AA, plus axe's own best-practice set, which catches things the
    // standard leaves implicit — a list containing non-list children, for instance.
    runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
  });

  if (results.violations.length > 0) {
    const report = results.violations
      .map((violation) => {
        const where = violation.nodes.map((node) => `      ${node.html.slice(0, 120)}`).join('\n');
        return `  ${violation.id} (${violation.impact}): ${violation.help}\n${where}`;
      })
      .join('\n\n');

    expect.fail(`axe found ${results.violations.length} violation(s):\n\n${report}`);
  }
}
