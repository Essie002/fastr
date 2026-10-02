import { describe, expect, it } from 'vitest';
import {
  activityStreak,
  activityTotals,
  groupByLocalDay,
  type ActivityCompletionLike,
} from './activityStats.js';

/**
 * Counts, streaks and day grouping for activities. Requirement 6.
 *
 * Every date here is fixed and every "now" is passed in, because a test that reads the clock fails at midnight
 * in one time zone and passes everywhere else — which is the hardest kind of flake to believe.
 */

const NOW = new Date('2026-06-15T12:00:00Z');
const ZONE = 'Africa/Nairobi'; // UTC+3 all year, so no DST noise in these cases.

function completion(
  daysAgo: number,
  overrides: Partial<ActivityCompletionLike> = {},
): ActivityCompletionLike {
  return {
    label: 'Walk',
    typeKey: 'walk',
    occurredAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    minutes: 20,
    ...overrides,
  };
}

describe('activityTotals (Req 6.2)', () => {
  it('counts the last 7 and 30 days separately', () => {
    const totals = activityTotals(
      [completion(0), completion(3), completion(10), completion(40)],
      NOW,
    );

    expect(totals).toHaveLength(1);
    expect(totals[0]!.last7).toBe(2);
    // The 40-day-old one is outside both windows.
    expect(totals[0]!.last30).toBe(3);
  });

  it('totals the time inside the 30-day window only', () => {
    // Scoped to match the count beside it: a lifetime total next to a 30-day count invites the reader to
    // compare two different periods.
    const totals = activityTotals([completion(1), completion(40)], NOW);
    expect(totals[0]!.totalMinutes).toBe(20);
  });

  it('treats a missing duration as zero rather than skipping the completion', () => {
    const totals = activityTotals([completion(1, { minutes: null })], NOW);
    expect(totals[0]!.last30).toBe(1);
    expect(totals[0]!.totalMinutes).toBe(0);
  });

  it('groups by label, so history survives the activity being deleted', () => {
    /*
     * The reason grouping is by label rather than by activity id: `activity_log.activity_id` is
     * `on delete set null`, so a completion outlives its activity. Grouping by id would drop that history
     * into an "unknown" bucket, which is the opposite of why it was kept.
     */
    const totals = activityTotals(
      [
        completion(1, { label: 'Swim', typeKey: 'swim' }),
        completion(2, { label: 'Swim', typeKey: 'swim' }),
        completion(3, { label: 'Walk' }),
      ],
      NOW,
    );

    expect(totals.map((total) => total.label)).toEqual(['Swim', 'Walk']);
    expect(totals[0]!.last30).toBe(2);
  });

  it('orders by recent volume, then by name', () => {
    const totals = activityTotals(
      [
        completion(1, { label: 'Walk' }),
        completion(2, { label: 'Swim', typeKey: 'swim' }),
        completion(3, { label: 'Swim', typeKey: 'swim' }),
      ],
      NOW,
    );
    expect(totals.map((total) => total.label)).toEqual(['Swim', 'Walk']);
  });

  it('returns nothing for no completions', () => {
    expect(activityTotals([], NOW)).toEqual([]);
  });
});

describe('activityStreak (Req 6.3)', () => {
  it('counts consecutive days ending today', () => {
    expect(activityStreak([completion(0), completion(1), completion(2)], ZONE, NOW)).toBe(3);
  });

  it('counts a streak that ends yesterday, because today is not over', () => {
    // The same allowance the fasting streak makes. Resetting at midnight would tell someone at 9am that
    // they had lost something they still had all day to keep.
    expect(activityStreak([completion(1), completion(2)], ZONE, NOW)).toBe(2);
  });

  it('is zero when the most recent completion is older than yesterday', () => {
    expect(activityStreak([completion(2), completion(3)], ZONE, NOW)).toBe(0);
  });

  it('stops at a gap', () => {
    expect(activityStreak([completion(0), completion(1), completion(3)], ZONE, NOW)).toBe(2);
  });

  it('counts a day once however many activities were logged on it', () => {
    expect(
      activityStreak([completion(0), completion(0, { label: 'Swim' }), completion(1)], ZONE, NOW),
    ).toBe(2);
  });

  it('is zero for no completions', () => {
    expect(activityStreak([], ZONE, NOW)).toBe(0);
  });

  it('uses the user\u2019s local day, not UTC', () => {
    /*
     * 22:30 UTC on 14 June is 01:30 on 15 June in Nairobi. So in Nairobi this is "today" and the streak is
     * 1; in UTC it is yesterday. Both answers are 1 here, which is why the assertion below is about the
     * boundary rather than the count: a completion at 21:30 UTC is 00:30 local on the 15th, still today,
     * while 20:30 UTC is 23:30 local on the 14th — yesterday.
     */
    const lateLocal = [{ ...completion(0), occurredAt: '2026-06-14T21:30:00Z' }];
    const earlierLocal = [{ ...completion(0), occurredAt: '2026-06-14T20:30:00Z' }];

    // Both still count, one as today and one as yesterday, so both give 1 — but they are different days,
    // which the grouping test below proves.
    expect(activityStreak(lateLocal, ZONE, NOW)).toBe(1);
    expect(activityStreak(earlierLocal, ZONE, NOW)).toBe(1);
    // Together they are two consecutive local days.
    expect(activityStreak([...lateLocal, ...earlierLocal], ZONE, NOW)).toBe(2);
  });
});

describe('groupByLocalDay (Req 6.1)', () => {
  it('buckets by the local day and puts the newest day first', () => {
    const groups = groupByLocalDay(
      [completion(0), completion(1), completion(1, { label: 'Swim' })],
      ZONE,
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]!.day > groups[1]!.day).toBe(true);
    expect(groups[1]!.items).toHaveLength(2);
  });

  it('splits two instants that fall on different local days', () => {
    // 21:30 UTC is 00:30 the next day in Nairobi; 20:30 UTC is 23:30 the same day. Grouping in UTC would
    // put these together and show someone a single day when they logged across two.
    const groups = groupByLocalDay(
      [
        { ...completion(0), occurredAt: '2026-06-14T21:30:00Z' },
        { ...completion(0), occurredAt: '2026-06-14T20:30:00Z' },
      ],
      ZONE,
    );

    expect(groups.map((group) => group.day)).toEqual(['2026-06-15', '2026-06-14']);
  });

  it('orders entries within a day newest first', () => {
    const groups = groupByLocalDay(
      [
        { ...completion(0), occurredAt: '2026-06-15T06:00:00Z', label: 'Early' },
        { ...completion(0), occurredAt: '2026-06-15T09:00:00Z', label: 'Late' },
      ],
      ZONE,
    );

    expect(groups[0]!.items.map((item) => item.label)).toEqual(['Late', 'Early']);
  });

  it('returns nothing for no completions', () => {
    expect(groupByLocalDay([], ZONE)).toEqual([]);
  });
});
