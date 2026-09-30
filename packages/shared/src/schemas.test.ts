import { describe, expect, it } from 'vitest';
import {
  MAX_NOTE_LENGTH,
  MAX_WEIGHT_GRAMS,
  MIN_WEIGHT_GRAMS,
  customGoalMinutesSchema,
  editFastSchema,
  goalMinutesSchema,
  profileUpdateSchema,
  reminderSchema,
  startFastSchema,
  timeZoneSchema,
  weightEntrySchema,
} from './schemas.js';
import { MAX_GOAL_MINUTES, MIN_GOAL_MINUTES } from './plans.js';

/**
 * These assert the boundaries. The parity test in `supabase/tests` then asserts Postgres draws them
 * in exactly the same place, which is the half that actually protects the data.
 */

describe('goalMinutesSchema', () => {
  it('accepts the boundaries and rejects just outside them', () => {
    expect(goalMinutesSchema.safeParse(MIN_GOAL_MINUTES).success).toBe(true);
    expect(goalMinutesSchema.safeParse(MAX_GOAL_MINUTES).success).toBe(true);
    expect(goalMinutesSchema.safeParse(MIN_GOAL_MINUTES - 1).success).toBe(false);
    expect(goalMinutesSchema.safeParse(MAX_GOAL_MINUTES + 1).success).toBe(false);
  });

  it('rejects a fraction of a minute', () => {
    expect(goalMinutesSchema.safeParse(960.5).success).toBe(false);
  });
});

describe('customGoalMinutesSchema', () => {
  it('holds to fifteen-minute steps', () => {
    expect(customGoalMinutesSchema.safeParse(975).success).toBe(true);
    expect(customGoalMinutesSchema.safeParse(967).success).toBe(false);
  });
});

describe('timeZoneSchema', () => {
  it('accepts real IANA names', () => {
    expect(timeZoneSchema.safeParse('Africa/Nairobi').success).toBe(true);
    expect(timeZoneSchema.safeParse('UTC').success).toBe(true);
  });

  it('rejects a plausible typo, which a regex would have let through', () => {
    expect(timeZoneSchema.safeParse('Africa/Nairobbi').success).toBe(false);
    expect(timeZoneSchema.safeParse('+03:00').success).toBe(false);
  });
});

describe('startFastSchema', () => {
  it('accepts a known plan with no explicit start', () => {
    expect(startFastSchema.safeParse({ planId: '16:8', goalMinutes: 960 }).success).toBe(true);
  });

  it('rejects an unknown plan id', () => {
    expect(startFastSchema.safeParse({ planId: '5:2', goalMinutes: 960 }).success).toBe(false);
  });

  it('requires a real instant when a start is given', () => {
    expect(
      startFastSchema.safeParse({ planId: '16:8', goalMinutes: 960, startAt: 'yesterday' }).success,
    ).toBe(false);
    expect(
      startFastSchema.safeParse({
        planId: '16:8',
        goalMinutes: 960,
        startAt: '2026-09-30T08:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('editFastSchema', () => {
  const base = {
    id: '11111111-1111-4111-8111-111111111111',
    startAt: '2026-09-30T08:00:00.000Z',
    goalMinutes: 960,
  };

  it('rejects an end before its start, on the end field', () => {
    const result = editFastSchema.safeParse({ ...base, endedAt: '2026-09-30T07:00:00.000Z' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['endedAt']);
  });

  it('rejects an end equal to its start', () => {
    expect(editFastSchema.safeParse({ ...base, endedAt: base.startAt }).success).toBe(false);
  });

  it('accepts a null end, which is an active fast', () => {
    expect(editFastSchema.safeParse({ ...base, endedAt: null }).success).toBe(true);
  });

  it('caps the note length', () => {
    expect(
      editFastSchema.safeParse({ ...base, endedAt: null, note: 'a'.repeat(MAX_NOTE_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      editFastSchema.safeParse({ ...base, endedAt: null, note: 'a'.repeat(MAX_NOTE_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it('bounds mood and energy to one through five', () => {
    expect(editFastSchema.safeParse({ ...base, endedAt: null, mood: 0 }).success).toBe(false);
    expect(editFastSchema.safeParse({ ...base, endedAt: null, mood: 6 }).success).toBe(false);
    expect(editFastSchema.safeParse({ ...base, endedAt: null, mood: 3 }).success).toBe(true);
  });
});

describe('weightEntrySchema', () => {
  it('accepts the boundaries and rejects just outside them', () => {
    const day = '2026-09-30';
    expect(weightEntrySchema.safeParse({ measuredOn: day, grams: MIN_WEIGHT_GRAMS }).success).toBe(
      true,
    );
    expect(weightEntrySchema.safeParse({ measuredOn: day, grams: MAX_WEIGHT_GRAMS }).success).toBe(
      true,
    );
    expect(
      weightEntrySchema.safeParse({ measuredOn: day, grams: MIN_WEIGHT_GRAMS - 1 }).success,
    ).toBe(false);
    expect(
      weightEntrySchema.safeParse({ measuredOn: day, grams: MAX_WEIGHT_GRAMS + 1 }).success,
    ).toBe(false);
  });

  it('requires a date with no time on it', () => {
    expect(
      weightEntrySchema.safeParse({ measuredOn: '2026-09-30T00:00:00Z', grams: 72_000 }).success,
    ).toBe(false);
  });
});

describe('profileUpdateSchema', () => {
  it('allows a partial update', () => {
    expect(profileUpdateSchema.safeParse({ theme: 'dark' }).success).toBe(true);
  });

  it('rejects an unknown theme or unit', () => {
    expect(profileUpdateSchema.safeParse({ theme: 'midnight' }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ weightUnit: 'stone' }).success).toBe(false);
  });

  it('allows clearing the custom goal but not setting a broken one', () => {
    expect(profileUpdateSchema.safeParse({ customGoalMinutes: null }).success).toBe(true);
    expect(profileUpdateSchema.safeParse({ customGoalMinutes: 7 }).success).toBe(false);
  });
});

describe('reminderSchema', () => {
  it('accepts a 24-hour time and at least one weekday', () => {
    expect(
      reminderSchema.safeParse({ localTime: '20:00', weekdays: [1], enabled: true }).success,
    ).toBe(true);
  });

  it('rejects a malformed time and an empty weekday list', () => {
    expect(
      reminderSchema.safeParse({ localTime: '8pm', weekdays: [1], enabled: true }).success,
    ).toBe(false);
    expect(
      reminderSchema.safeParse({ localTime: '24:00', weekdays: [1], enabled: true }).success,
    ).toBe(false);
    expect(
      reminderSchema.safeParse({ localTime: '20:00', weekdays: [], enabled: true }).success,
    ).toBe(false);
  });

  it('rejects a weekday outside zero to six', () => {
    expect(
      reminderSchema.safeParse({ localTime: '20:00', weekdays: [7], enabled: true }).success,
    ).toBe(false);
  });
});
