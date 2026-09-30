import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PLAN_ID,
  DEFAULT_PLAN_ID,
  EXTENDED_THRESHOLD_MINUTES,
  MAX_GOAL_MINUTES,
  MIN_GOAL_MINUTES,
  PLANS,
  findPlan,
  goalMinutesFor,
  isExtendedGoal,
  isValidCustomGoal,
} from './plans.js';

describe('the plan catalog', () => {
  it('contains every plan the requirements name', () => {
    // Requirement 4.1, asserted by id so a renamed label cannot quietly drop a plan.
    expect(PLANS.map((plan) => plan.id)).toEqual([
      '12:12',
      '14:10',
      '16:8',
      '18:6',
      '20:4',
      '23:1',
      '24h',
      '36h',
      CUSTOM_PLAN_ID,
    ]);
  });

  it('gives every plan the fields the catalog screen shows', () => {
    // Requirement 4.2.
    for (const plan of PLANS) {
      expect(plan.label).not.toBe('');
      expect(plan.fastMinutes).toBeGreaterThanOrEqual(MIN_GOAL_MINUTES);
      expect(plan.fastMinutes).toBeLessThanOrEqual(MAX_GOAL_MINUTES);
      expect(['beginner', 'intermediate', 'advanced']).toContain(plan.difficulty);
      // Long enough to be a real sentence rather than a placeholder.
      expect(plan.description.length).toBeGreaterThan(40);
    }
  });

  it('marks exactly the plans of 24 hours and over as extended', () => {
    // Requirement 4.3. The flag is derived, and this is the test that keeps it honest.
    for (const plan of PLANS) {
      expect(plan.extended).toBe(plan.fastMinutes >= EXTENDED_THRESHOLD_MINUTES);
    }
    expect(PLANS.filter((plan) => plan.extended).map((plan) => plan.id)).toEqual(['24h', '36h']);
  });

  it('has an eating window that completes the day', () => {
    for (const plan of PLANS) {
      expect(plan.fastMinutes + plan.eatMinutes).toBe(24 * 60);
    }
  });

  it('has exactly one custom plan, and it is the default target of neither', () => {
    expect(PLANS.filter((plan) => plan.custom)).toHaveLength(1);
    expect(findPlan(DEFAULT_PLAN_ID)?.custom).toBe(false);
  });
});

describe('goalMinutesFor', () => {
  it('uses the plan length for a fixed plan, ignoring any custom value', () => {
    const plan = findPlan('16:8')!;
    expect(goalMinutesFor(plan, null)).toBe(16 * 60);
    expect(goalMinutesFor(plan, 999)).toBe(16 * 60);
  });

  it('uses the profile value for the custom plan', () => {
    expect(goalMinutesFor(findPlan(CUSTOM_PLAN_ID)!, 17 * 60 + 15)).toBe(1035);
  });

  it('throws rather than silently falling back when the custom value is missing', () => {
    // Falling back to the placeholder would start a fast with a goal the user never chose, which is
    // worse than an error, because nothing would look wrong.
    expect(() => goalMinutesFor(findPlan(CUSTOM_PLAN_ID)!, null)).toThrow(/customGoalMinutes/);
  });
});

describe('isValidCustomGoal', () => {
  it('accepts the boundaries', () => {
    // Requirement 4.5: 1 to 72 hours.
    expect(isValidCustomGoal(60)).toBe(true);
    expect(isValidCustomGoal(MAX_GOAL_MINUTES)).toBe(true);
  });

  it('rejects just outside the boundaries', () => {
    expect(isValidCustomGoal(45)).toBe(false);
    expect(isValidCustomGoal(MAX_GOAL_MINUTES + 15)).toBe(false);
  });

  it('rejects anything off a fifteen-minute step', () => {
    expect(isValidCustomGoal(16 * 60 + 7)).toBe(false);
    expect(isValidCustomGoal(16 * 60 + 15)).toBe(true);
  });
});

describe('isExtendedGoal', () => {
  it('turns on at exactly 24 hours and not a minute before', () => {
    // Requirement 17.2's confirmation hangs off this boundary.
    expect(isExtendedGoal(24 * 60 - 1)).toBe(false);
    expect(isExtendedGoal(24 * 60)).toBe(true);
  });
});
