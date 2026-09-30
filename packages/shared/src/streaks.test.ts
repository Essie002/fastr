import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CompletedFast } from './types.js';
import { actualMinutes, currentStreak, longestStreak, metGoal, stats } from './streaks.js';
import { localDayOf } from './time.js';

const NAIROBI = 'Africa/Nairobi'; // UTC+3, no daylight saving
const LONDON = 'Europe/London'; // has daylight saving, which is the point

/** A finished fast ending at `endedAt`, `minutes` long, with a goal it met unless told otherwise. */
function fast(endedAt: string, minutes = 16 * 60, goalMinutes = minutes): CompletedFast {
  const end = new Date(endedAt);
  return {
    id: endedAt,
    userId: 'u1',
    planId: '16:8',
    goalMinutes,
    startAt: new Date(end.getTime() - minutes * 60_000).toISOString(),
    endedAt: end.toISOString(),
    status: 'completed',
    mood: null,
    energy: null,
    note: null,
  };
}

describe('actualMinutes and metGoal', () => {
  it('measures the real length, which can be short of the goal', () => {
    const short = fast('2026-09-30T12:00:00Z', 14 * 60, 16 * 60);
    expect(actualMinutes(short)).toBe(14 * 60);
    expect(metGoal(short)).toBe(false);
  });

  it('counts reaching the goal exactly as meeting it', () => {
    expect(metGoal(fast('2026-09-30T12:00:00Z', 960, 960))).toBe(true);
  });
});

describe('currentStreak', () => {
  const now = new Date('2026-09-30T10:00:00Z'); // Wednesday, 13:00 in Nairobi

  it('is zero with no fasts', () => {
    expect(currentStreak([], NAIROBI, now)).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    const fasts = [
      fast('2026-09-30T09:00:00Z'),
      fast('2026-09-29T09:00:00Z'),
      fast('2026-09-28T09:00:00Z'),
    ];
    expect(currentStreak(fasts, NAIROBI, now)).toBe(3);
  });

  it('still counts a streak that ends yesterday', () => {
    // Requirement 10.1. Without this, the number reads zero from midnight until today's fast ends,
    // which is exactly when the user is looking at it.
    const fasts = [fast('2026-09-29T09:00:00Z'), fast('2026-09-28T09:00:00Z')];
    expect(currentStreak(fasts, NAIROBI, now)).toBe(2);
  });

  it('is zero once the most recent qualifying day is two days back', () => {
    expect(currentStreak([fast('2026-09-28T09:00:00Z')], NAIROBI, now)).toBe(0);
  });

  it('stops at the first gap', () => {
    const fasts = [
      fast('2026-09-30T09:00:00Z'),
      fast('2026-09-29T09:00:00Z'),
      // 28th missing
      fast('2026-09-27T09:00:00Z'),
    ];
    expect(currentStreak(fasts, NAIROBI, now)).toBe(2);
  });

  it('ignores a fast that did not meet its goal', () => {
    const fasts = [fast('2026-09-30T09:00:00Z', 10 * 60, 16 * 60), fast('2026-09-29T09:00:00Z')];
    expect(currentStreak(fasts, NAIROBI, now)).toBe(1);
  });

  it('counts two fasts on one day once', () => {
    const fasts = [fast('2026-09-30T09:00:00Z'), fast('2026-09-30T02:00:00Z')];
    expect(currentStreak(fasts, NAIROBI, now)).toBe(1);
  });

  it('credits the day the fast ended in the user zone, not in UTC', () => {
    // 22:30 UTC on the 29th is 01:30 on the 30th in Nairobi. The naive version credits the 29th and
    // reports a broken streak.
    const ended = '2026-09-29T22:30:00Z';
    expect(localDayOf(ended, NAIROBI)).toBe('2026-09-30');
    expect(currentStreak([fast(ended)], NAIROBI, now)).toBe(1);
  });
});

describe('longestStreak', () => {
  it('finds the longest run anywhere in history', () => {
    const fasts = [
      fast('2026-01-01T09:00:00Z'),
      fast('2026-01-02T09:00:00Z'),
      fast('2026-01-03T09:00:00Z'),
      fast('2026-01-04T09:00:00Z'),
      // gap
      fast('2026-03-01T09:00:00Z'),
      fast('2026-03-02T09:00:00Z'),
    ];
    expect(longestStreak(fasts, NAIROBI)).toBe(4);
  });

  it('is zero with no qualifying fasts', () => {
    expect(longestStreak([fast('2026-01-01T09:00:00Z', 60, 960)], NAIROBI)).toBe(0);
  });

  it('handles a single day', () => {
    expect(longestStreak([fast('2026-01-01T09:00:00Z')], NAIROBI)).toBe(1);
  });

  it('counts a run crossing a month boundary', () => {
    const fasts = [
      fast('2026-01-30T09:00:00Z'),
      fast('2026-01-31T09:00:00Z'),
      fast('2026-02-01T09:00:00Z'),
    ];
    expect(longestStreak(fasts, NAIROBI)).toBe(3);
  });
});

describe('stats', () => {
  const now = new Date('2026-09-30T10:00:00Z');

  it('returns nulls rather than zeros with no data', () => {
    // Zero would render as "0h average", which is a claim. Null renders as "no data yet".
    expect(stats([], now)).toEqual({
      totalCompleted: 0,
      averageMinutesLast7: null,
      averageMinutesLast30: null,
      longestMinutes: null,
      goalCompletionRate: null,
    });
  });

  it('averages only fasts inside each window', () => {
    const fasts = [
      fast('2026-09-29T09:00:00Z', 16 * 60),
      fast('2026-09-27T09:00:00Z', 18 * 60),
      fast('2026-09-10T09:00:00Z', 12 * 60), // inside 30 days, outside 7
    ];
    const result = stats(fasts, now);
    expect(result.averageMinutesLast7).toBe(17 * 60);
    expect(result.averageMinutesLast30).toBe(Math.round((16 * 60 + 18 * 60 + 12 * 60) / 3));
  });

  it('reports the longest fast and the goal completion rate over all finished fasts', () => {
    const fasts = [
      fast('2026-09-29T09:00:00Z', 20 * 60),
      fast('2026-09-28T09:00:00Z', 10 * 60, 16 * 60), // missed
    ];
    const result = stats(fasts, now);
    expect(result.longestMinutes).toBe(20 * 60);
    expect(result.totalCompleted).toBe(1);
    expect(result.goalCompletionRate).toBe(0.5);
  });
});

describe('properties', () => {
  // A generator of qualifying fasts spread over a couple of months.
  const fastsArb = fc
    .array(fc.integer({ min: 0, max: 60 }), { minLength: 0, maxLength: 40 })
    .map((offsets) =>
      offsets.map((days) => {
        const end = new Date(Date.UTC(2026, 6, 1, 9, 0) + days * 86_400_000);
        return fast(end.toISOString());
      }),
    );

  it('is invariant under the order of the input', () => {
    // Requirement 10.6. History arrives ordered by one column and gets re-sorted for another view,
    // and a streak that depends on that order is a bug that only shows up on one screen.
    fc.assert(
      fc.property(fastsArb, (fasts) => {
        const reversed = [...fasts].reverse();
        const now = new Date('2026-09-01T12:00:00Z');
        expect(currentStreak(reversed, NAIROBI, now)).toBe(currentStreak(fasts, NAIROBI, now));
        expect(longestStreak(reversed, NAIROBI)).toBe(longestStreak(fasts, NAIROBI));
      }),
      { numRuns: 200 },
    );
  });

  it('never reports a current streak longer than the longest streak', () => {
    fc.assert(
      fc.property(fastsArb, (fasts) => {
        const now = new Date('2026-09-01T12:00:00Z');
        expect(currentStreak(fasts, NAIROBI, now)).toBeLessThanOrEqual(
          longestStreak(fasts, NAIROBI),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('counts a day exactly once across a daylight saving transition', () => {
    // Requirement 10.6. London goes forward on 29 March 2026 and back on 25 October 2026. A streak
    // walked with millisecond arithmetic lands on the same date twice around those dates, or skips
    // one, and either way the number is wrong for a week.
    const transitions = [
      { start: Date.UTC(2026, 2, 26, 12), label: 'spring forward' },
      { start: Date.UTC(2026, 9, 22, 12), label: 'fall back' },
    ];

    for (const { start } of transitions) {
      const fasts = Array.from({ length: 7 }, (_, index) =>
        fast(new Date(start + index * 86_400_000).toISOString()),
      );
      const days = new Set(fasts.map((f) => localDayOf(f.endedAt, LONDON)));
      expect(days.size).toBe(7);
      expect(longestStreak(fasts, LONDON)).toBe(7);
    }
  });
});
