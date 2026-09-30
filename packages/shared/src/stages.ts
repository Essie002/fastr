import type { FastingStage } from './types.js';

/**
 * The fasting stages shown on the timer. Requirement 6.1.
 *
 * This list is the single source of truth in two places at once: the web app imports it directly,
 * and `npm run gen:stages` writes it into a migration so the notification trigger can read it in
 * SQL. Requirement 6.6 is the reason it is not typed out twice, and the CI drift check is the reason
 * it cannot quietly become two lists.
 *
 * Requirement 6.5 governs the wording. Every description hedges, because these timings are averages
 * from small studies, they vary with the person, what they last ate, and how active they are, and
 * the app is not in a position to tell anyone what their own body is doing.
 */
export const STAGES: readonly FastingStage[] = [
  {
    key: 'blood_sugar_rising',
    atMinutes: 0,
    name: 'Blood sugar rising',
    description:
      'Your last meal is still being digested and blood sugar is up. The body is running on what you just ate.',
  },
  {
    key: 'blood_sugar_falling',
    atMinutes: 2 * 60,
    name: 'Blood sugar falling',
    description:
      'Digestion is finishing and blood sugar typically starts to come back down. Insulin usually falls with it.',
  },
  {
    key: 'blood_sugar_normal',
    atMinutes: 5 * 60,
    name: 'Blood sugar normal',
    description:
      'Blood sugar is generally back to its baseline. The body is drawing on glycogen stored in the liver for energy.',
  },
  {
    key: 'fat_burning',
    atMinutes: 12 * 60,
    name: 'Fat burning begins',
    description:
      'Liver glycogen is often running low by around this point, and the body typically turns more to stored fat for fuel.',
  },
  {
    key: 'ketosis',
    atMinutes: 18 * 60,
    name: 'Ketosis',
    description:
      'The liver may start producing ketones from fat in useful amounts. How quickly this happens varies a lot between people.',
  },
  {
    key: 'autophagy',
    atMinutes: 24 * 60,
    name: 'Autophagy',
    description:
      'Cellular clean-up, where cells recycle worn-out parts, is thought to increase around this point. Most of the evidence comes from animal studies, so treat the timing loosely.',
  },
  {
    key: 'growth_hormone',
    atMinutes: 48 * 60,
    name: 'Growth hormone rising',
    description:
      'Growth hormone has been measured rising substantially in fasts of around this length, though the studies are small. This is deep into extended-fast territory.',
  },
  {
    key: 'immune_reset',
    atMinutes: 72 * 60,
    name: 'Immune reset',
    description:
      'Some research points to immune cell renewal around three days. A fast this long is not something to attempt without medical supervision.',
  },
];

/**
 * The stage a fast is in after this many minutes.
 *
 * The list is ordered and starts at zero, so the answer is the last stage whose start has passed.
 * Negative input is treated as the first stage rather than an error: a backdated start being edited
 * can briefly produce a small negative elapsed time, and throwing there would break the timer over
 * something the user is about to fix.
 */
export function stageAt(elapsedMinutes: number): FastingStage {
  // Non-null: STAGES is a non-empty literal and the first entry is at 0, so at least one matches.
  let current = STAGES[0]!;
  for (const stage of STAGES) {
    if (stage.atMinutes <= elapsedMinutes) current = stage;
    else break;
  }
  return current;
}

/** The stage after the current one, or null once the last has been reached. */
export function nextStage(elapsedMinutes: number): FastingStage | null {
  return STAGES.find((stage) => stage.atMinutes > elapsedMinutes) ?? null;
}

/** Minutes until the next stage, or null at the last one. Requirement 6.2. */
export function minutesToNextStage(elapsedMinutes: number): number | null {
  const next = nextStage(elapsedMinutes);
  return next === null ? null : next.atMinutes - elapsedMinutes;
}

/**
 * The stages whose boundaries fall inside a fast's goal, which is what the progress ring marks.
 *
 * The stage at zero is excluded: it is where every fast starts, so a marker on it would sit on the
 * ring's origin and mean nothing. Requirement 6.3.
 */
export function stagesWithin(goalMinutes: number): readonly FastingStage[] {
  return STAGES.filter((stage) => stage.atMinutes > 0 && stage.atMinutes <= goalMinutes);
}

export function findStage(key: string): FastingStage | undefined {
  return STAGES.find((stage) => stage.key === key);
}
