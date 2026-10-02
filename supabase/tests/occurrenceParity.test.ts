/**
 * The TypeScript `nextOccurrence` and the SQL `activity_occurrences` agree. Requirement 7.4.
 *
 * This is the project's one accepted duplication of logic. The activities list shows "next at 07:00" for every
 * row, and the alternative is a round trip per render for a number whose only purpose is letting someone notice
 * a misconfigured schedule before it misfires. So the arithmetic exists twice.
 *
 * Duplication is only survivable if something holds the copies together, and this is that thing: the same
 * fixtures driven through both, asserted equal. Without it the list would eventually promise one time while the
 * scheduler queued another, and the user would have no way to tell which was lying.
 *
 * The SQL side is asked via `as_of`, so both implementations are given the same "now" rather than racing the
 * real clock.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { nextOccurrence, type ScheduleShape } from '../../packages/shared/src/occurrences.js';
import {
  SEED_USERS,
  hasStack,
  localStack,
  resetUserData,
  serviceClient,
  type LocalStack,
} from './helpers.js';

interface Occurrence {
  schedule_id: string;
  due_at: string;
}

/** Every case is run in both zones, so a bug that only shows at a non-zero offset cannot hide. */
const ZONES = ['Africa/Nairobi', 'Europe/London'] as const;

const CASES: { name: string; schedule: ScheduleShape; asOf: string }[] = [
  {
    name: 'a daily wall-clock schedule',
    schedule: { kind: 'at', localTime: '07:00', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    asOf: '2026-06-15T03:00:00Z',
  },
  {
    name: 'a wall-clock schedule later today',
    schedule: { kind: 'at', localTime: '23:30', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    asOf: '2026-06-15T10:00:00Z',
  },
  {
    name: 'a single-weekday schedule',
    // Monday only, asked on a Monday after it has passed, so the answer is a week away.
    schedule: { kind: 'at', localTime: '06:00', weekdays: [1] },
    asOf: '2026-06-15T09:00:00Z',
  },
  {
    name: 'an interval schedule mid-window',
    schedule: {
      kind: 'every',
      windowStart: '08:00',
      windowEnd: '20:00',
      intervalMinutes: 120,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    },
    asOf: '2026-06-15T08:00:00Z',
  },
  {
    name: 'an interval schedule after its window has closed',
    schedule: {
      kind: 'every',
      windowStart: '08:00',
      windowEnd: '12:00',
      intervalMinutes: 60,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    },
    asOf: '2026-06-15T18:00:00Z',
  },
  {
    name: 'an interval schedule whose step does not divide its window',
    schedule: {
      kind: 'every',
      windowStart: '08:00',
      windowEnd: '20:00',
      intervalMinutes: 150,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    },
    asOf: '2026-06-15T05:00:00Z',
  },
  {
    name: 'a schedule across a daylight saving change',
    // 2026-03-29 is when Europe/London springs forward. Nairobi never changes, so this case also proves
    // the agreement is not an accident of both being wrong in the same zone.
    schedule: { kind: 'at', localTime: '09:00', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    asOf: '2026-03-28T20:00:00Z',
  },
  {
    name: 'a schedule on the day the clocks go back',
    schedule: { kind: 'at', localTime: '09:00', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    asOf: '2026-10-24T20:00:00Z',
  },
];

describe.skipIf(!hasStack())('nextOccurrence agrees with activity_occurrences', () => {
  let stack: LocalStack;
  let service: SupabaseClient;
  const userId = SEED_USERS.a.id;

  beforeAll(() => {
    stack = localStack()!;
    service = serviceClient(stack);
  });

  afterAll(async () => {
    await resetUserData(stack);
    await service.from('profiles').update({ time_zone: 'Africa/Nairobi' }).eq('id', userId);
  });

  beforeEach(async () => {
    await resetUserData(stack);
  });

  /** Plants the schedule and asks SQL for the first occurrence at or after `asOf`. */
  async function sqlNext(
    schedule: ScheduleShape,
    asOf: string,
    zone: string,
  ): Promise<Date | null> {
    await service
      .from('profiles')
      .update({ time_zone: zone, notify_activities: true })
      .eq('id', userId);

    const { data: activity, error: activityError } = await service
      .from('activities')
      .insert({ user_id: userId, type_key: 'swim', duration_minutes: 45 })
      .select('id')
      .single();
    expect(activityError).toBeNull();

    const row =
      schedule.kind === 'at'
        ? { kind: 'at', local_time: schedule.localTime, weekdays: schedule.weekdays }
        : {
            kind: 'every',
            window_start: schedule.windowStart,
            window_end: schedule.windowEnd,
            interval_minutes: schedule.intervalMinutes,
            weekdays: schedule.weekdays,
          };

    const { data: created, error: scheduleError } = await service
      .from('activity_schedules')
      .insert({ activity_id: (activity as { id: string }).id, ...row })
      .select('id')
      .single();
    expect(scheduleError).toBeNull();
    const scheduleId = (created as { id: string }).id;

    /*
     * A ten-day window forward from `asOf`, which covers the longest gap a weekly schedule can produce.
     *
     * `activity_occurrences` only generates three local days around `as_of`, so a single call cannot see a
     * week ahead. Walking `as_of` forward a day at a time and taking the earliest answer is what makes the
     * comparison fair — the SQL function is built for a twenty-minute horizon, not for answering "when
     * next", and this test is asking it a question the scheduler never asks.
     */
    let earliest: Date | null = null;
    for (let dayOffset = 0; dayOffset <= 9 && earliest === null; dayOffset += 1) {
      const walked = new Date(Date.parse(asOf) + dayOffset * 86_400_000).toISOString();
      const { data, error } = await service.rpc('activity_occurrences', {
        from_at: asOf,
        to_at: new Date(Date.parse(asOf) + 11 * 86_400_000).toISOString(),
        as_of: walked,
      });
      expect(error).toBeNull();

      const mine = ((data ?? []) as Occurrence[])
        .filter((occ) => occ.schedule_id === scheduleId)
        .map((occ) => new Date(occ.due_at))
        .filter((at) => at.getTime() >= Date.parse(asOf))
        .sort((a, b) => a.getTime() - b.getTime());

      if (mine.length > 0) earliest = mine[0]!;
    }

    return earliest;
  }

  for (const zone of ZONES) {
    describe(zone, () => {
      for (const testCase of CASES) {
        it(`agrees on ${testCase.name}`, async () => {
          const ts = nextOccurrence(testCase.schedule, new Date(testCase.asOf), zone);
          const sql = await sqlNext(testCase.schedule, testCase.asOf, zone);

          expect(ts, 'TypeScript found no occurrence').not.toBeNull();
          expect(sql, 'SQL found no occurrence').not.toBeNull();
          expect(ts!.toISOString()).toBe(sql!.toISOString());
        });
      }
    });
  }

  it('returns null for a disabled schedule without asking the database', () => {
    expect(
      nextOccurrence(
        { kind: 'at', localTime: '07:00', weekdays: [1], enabled: false },
        new Date('2026-06-15T00:00:00Z'),
        'Africa/Nairobi',
      ),
    ).toBeNull();
  });

  it('returns null when no weekday is selected', () => {
    // Unreachable through the UI and the schema, but a null is a better answer than a crash in a list.
    expect(
      nextOccurrence(
        { kind: 'at', localTime: '07:00', weekdays: [] },
        new Date('2026-06-15T00:00:00Z'),
        'Africa/Nairobi',
      ),
    ).toBeNull();
  });
});
