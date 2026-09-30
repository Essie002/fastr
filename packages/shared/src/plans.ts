import type { FastingPlan, PlanId } from './types.js';

/**
 * The plan catalog. Requirement 4.8 keeps this in code rather than in a table: adding a plan should
 * be a pull request with a test, not a row somebody edits at one in the morning.
 *
 * `extended` is derived from the length rather than typed by hand, so a plan added later cannot
 * arrive without its notice. Requirement 4.3 and 17.2 both depend on that flag being right.
 */

const MINUTES_PER_DAY = 24 * 60;

/** Requirement 17.3. A single fast may not be longer than this, enforced again in Postgres. */
export const MAX_GOAL_MINUTES = 72 * 60;

/** A fast shorter than an hour is a typo, not a plan. */
export const MIN_GOAL_MINUTES = 60;

/** Requirement 4.5. The custom control moves in quarter-hours. */
export const CUSTOM_STEP_MINUTES = 15;

/** Requirement 4.3. At or above a day counts as an extended fast. */
export const EXTENDED_THRESHOLD_MINUTES = MINUTES_PER_DAY;

export const CUSTOM_PLAN_ID = 'custom';

interface PlanSeed {
  id: PlanId;
  label: string;
  fastMinutes: number;
  difficulty: FastingPlan['difficulty'];
  description: string;
}

/**
 * Descriptions are written for somebody who has not met the jargon before, which is the whole point
 * of Requirement 4.2. "16:8" means nothing on its own.
 */
const SEEDS: readonly PlanSeed[] = [
  {
    id: '12:12',
    label: '12:12',
    fastMinutes: 12 * 60,
    difficulty: 'beginner',
    description:
      'Eat within a twelve-hour window and fast for the other twelve. For most people this is a late breakfast and an early dinner, so it is the gentlest place to start.',
  },
  {
    id: '14:10',
    label: '14:10',
    fastMinutes: 14 * 60,
    difficulty: 'beginner',
    description:
      'A ten-hour eating window. A step up from 12:12 that usually only means skipping a late-night snack.',
  },
  {
    id: '16:8',
    label: '16:8',
    fastMinutes: 16 * 60,
    difficulty: 'intermediate',
    description:
      'The most common plan. Fast for sixteen hours and eat across eight, which in practice means skipping breakfast and eating between midday and eight in the evening.',
  },
  {
    id: '18:6',
    label: '18:6',
    fastMinutes: 18 * 60,
    difficulty: 'intermediate',
    description:
      'A six-hour eating window, so usually two meals rather than three. Harder to fit around a normal working day than 16:8.',
  },
  {
    id: '20:4',
    label: '20:4',
    fastMinutes: 20 * 60,
    difficulty: 'advanced',
    description:
      'Four hours to eat, sometimes called the warrior fast. One large meal and perhaps a snack.',
  },
  {
    id: '23:1',
    label: 'OMAD',
    fastMinutes: 23 * 60,
    difficulty: 'advanced',
    description:
      'One meal a day, inside a single hour. Everything you eat has to fit in that hour, which takes planning.',
  },
  {
    id: '24h',
    label: '24 hours',
    fastMinutes: MINUTES_PER_DAY,
    difficulty: 'advanced',
    description:
      'A full day, usually dinner to dinner. Long enough to count as an extended fast, so read the notice first.',
  },
  {
    id: '36h',
    label: '36 hours',
    fastMinutes: 36 * 60,
    difficulty: 'advanced',
    description:
      'A day and a half, covering a whole night and the day either side of it. Not a place to begin.',
  },
  {
    id: CUSTOM_PLAN_ID,
    label: 'Custom',
    // A placeholder. The real length comes from the profile's `customGoalMinutes`.
    fastMinutes: 16 * 60,
    difficulty: 'intermediate',
    description:
      'Choose your own length, anywhere from one to seventy-two hours, in fifteen-minute steps.',
  },
];

export const PLANS: readonly FastingPlan[] = SEEDS.map((seed) => ({
  ...seed,
  eatMinutes: MINUTES_PER_DAY - seed.fastMinutes,
  extended: seed.fastMinutes >= EXTENDED_THRESHOLD_MINUTES,
  custom: seed.id === CUSTOM_PLAN_ID,
}));

export const DEFAULT_PLAN_ID: PlanId = '16:8';

export function findPlan(id: PlanId): FastingPlan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

/**
 * The goal a fast started on this plan should get. The custom plan is the only one that needs the
 * profile's own number, and falling back to the plan's placeholder when that is missing is wrong in
 * a silent way, so it throws instead.
 */
export function goalMinutesFor(plan: FastingPlan, customGoalMinutes: number | null): number {
  if (!plan.custom) return plan.fastMinutes;
  if (customGoalMinutes === null) {
    throw new Error('The custom plan needs customGoalMinutes on the profile.');
  }
  return customGoalMinutes;
}

/** Requirement 4.5 and 17.3, in one place so the form and the tests agree. */
export function isValidCustomGoal(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    minutes >= MIN_GOAL_MINUTES &&
    minutes <= MAX_GOAL_MINUTES &&
    minutes % CUSTOM_STEP_MINUTES === 0
  );
}

/** Requirement 4.3 and 17.2, for a goal rather than a plan, since a custom goal can be extended. */
export function isExtendedGoal(goalMinutes: number): boolean {
  return goalMinutes >= EXTENDED_THRESHOLD_MINUTES;
}
