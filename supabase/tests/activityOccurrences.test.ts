/**
 * Deriving occurrences from schedules. Requirements 2.1, 2.2, 2.4, 3.3, 3.5, 8.1, 8.3.
 *
 * Against real Postgres, because the entire function is time-zone arithmetic and that is exactly what a mock
 * cannot check. Every "what time is it there" question is asked of Postgres rather than computed in JavaScript,
 * for the reason the reminders suite records: adding minutes to a wall-clock string wraps wrongly past midnight,
 * and the resulting test fails for one half-hour a day in one zone.
 *
 * `activity_occurrences` is pure, which is what makes this suite possible — it can be asked what a schedule
 * produces without anything being queued, claimed or delivered.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
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
  activity_id: string;
  user_id: string;
  due_at: string;
  minutes: number;
  notify_end: boolean;
}

interface LocalNow {
  time: string;
  dow: number;
  date: string;
}

describe.skipIf(!hasStack())('activity_occurrences', () => {
  let stack: LocalStack;
  let service: SupabaseClient;
  const userId = SEED_USERS.a.id;

  beforeAll(() => {
    stack = localStack()!;
    service = serviceClient(stack);
  });

  async function setZone(zone: string) {
    const { error } = await service.from('profiles').update({ time_zone: zone }).eq('id', userId);
    expect(error).toBeNull();
  }

  afterAll(async () => {
    await resetUserData(stack);
    await setZone('Africa/Nairobi');
  });

  beforeEach(async () => {
    await resetUserData(stack);
    await setZone('Africa/Nairobi');
    await service.from('profiles').update({ notify_activities: true }).eq('id', userId);
  });

  /** The user's local wall clock, straight from Postgres. */
  async function localNow(offsetMinutes = 0): Promise<LocalNow> {
    const { data, error } = await service.rpc('fastr_test_local_now', {
      user_id: userId,
      offset_minutes: offsetMinutes,
    });
    expect(error).toBeNull();
    return data as LocalNow;
  }

  /** An activity, returning its id. */
  async function makeActivity(overrides: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await service
      .from('activities')
      .insert({
        user_id: userId,
        type_key: 'swim',
        duration_minutes: 45,
        ...overrides,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    return (data as { id: string }).id;
  }

  async function makeSchedule(activityId: string, fields: Record<string, unknown>) {
    const { data, error } = await service
      .from('activity_schedules')
      .insert({ activity_id: activityId, user_id: userId, ...fields })
      .select('id')
      .single();
    expect(error).toBeNull();
    return (data as { id: string }).id;
  }

  /** Occurrences in a window around now, expressed in minutes. */
  async function occurrences(fromMinutes: number, toMinutes: number): Promise<Occurrence[]> {
    const now = Date.now();
    const { data, error } = await service.rpc('activity_occurrences', {
      from_at: new Date(now + fromMinutes * 60_000).toISOString(),
      to_at: new Date(now + toMinutes * 60_000).toISOString(),
    });
    expect(error).toBeNull();
    return (data ?? []) as Occurrence[];
  }

  /**
   * Occurrences as the function would see them on a given day, by passing `as_of`.
   *
   * This is why `activity_occurrences` takes that parameter: the alternative is mocking Postgres's clock, and
   * the alternative to *that* is reimplementing the schedule arithmetic in the test, which would only prove
   * two implementations agree with each other.
   */
  async function occurrencesAsOf(asOf: string, windowHours = 36): Promise<Occurrence[]> {
    const centre = Date.parse(asOf);
    const { data, error } = await service.rpc('activity_occurrences', {
      from_at: new Date(centre - windowHours * 3_600_000).toISOString(),
      to_at: new Date(centre + windowHours * 3_600_000).toISOString(),
      as_of: asOf,
    });
    expect(error).toBeNull();
    return (data ?? []) as Occurrence[];
  }

  /** `HH:MM` for an instant, in a named zone. Formatting for assertion, not schedule arithmetic. */
  function wallClock(iso: string, zone: string): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  }

  /** The calendar date for an instant, in a named zone. */
  function localDate(iso: string, zone: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(iso));
  }

  describe('a wall-clock schedule (Req 2.1, 2.2)', () => {
    it('produces an occurrence on a matching weekday', async () => {
      const now = await localNow(30);
      const activity = await makeActivity();
      const schedule = await makeSchedule(activity, {
        kind: 'at',
        local_time: now.time,
        weekdays: [now.dow],
      });

      const found = await occurrences(0, 60);
      expect(found.map((row) => row.schedule_id)).toContain(schedule);
    });

    it('produces nothing on a non-matching weekday', async () => {
      const now = await localNow(30);
      const activity = await makeActivity();
      // Every weekday except the one it is now, locally.
      const others = [0, 1, 2, 3, 4, 5, 6].filter((day) => day !== now.dow);
      const schedule = await makeSchedule(activity, {
        kind: 'at',
        local_time: now.time,
        weekdays: others,
      });

      const found = await occurrences(0, 60);
      expect(found.map((row) => row.schedule_id)).not.toContain(schedule);
    });

    it('carries the activity duration and end-reminder flag through', async () => {
      const now = await localNow(30);
      const activity = await makeActivity({ duration_minutes: 20, notify_end: true });
      const schedule = await makeSchedule(activity, {
        kind: 'at',
        local_time: now.time,
        weekdays: [now.dow],
      });

      const row = (await occurrences(0, 60)).find((item) => item.schedule_id === schedule);
      expect(row?.minutes).toBe(20);
      expect(row?.notify_end).toBe(true);
    });

    it('produces nothing for a disabled schedule, a disabled activity, or a silenced user', async () => {
      const now = await localNow(30);

      const disabledSchedule = await makeActivity();
      const a = await makeSchedule(disabledSchedule, {
        kind: 'at',
        local_time: now.time,
        weekdays: [now.dow],
        enabled: false,
      });

      const disabledActivity = await makeActivity({ enabled: false });
      const b = await makeSchedule(disabledActivity, {
        kind: 'at',
        local_time: now.time,
        weekdays: [now.dow],
      });

      let found = await occurrences(0, 60);
      expect(found.map((row) => row.schedule_id)).not.toContain(a);
      expect(found.map((row) => row.schedule_id)).not.toContain(b);

      // Requirement 4.8. The master switch silences everything at the source.
      const live = await makeActivity();
      const c = await makeSchedule(live, {
        kind: 'at',
        local_time: now.time,
        weekdays: [now.dow],
      });
      expect((await occurrences(0, 60)).map((row) => row.schedule_id)).toContain(c);

      await service.from('profiles').update({ notify_activities: false }).eq('id', userId);
      found = await occurrences(0, 60);
      expect(found).toHaveLength(0);
    });
  });

  describe('an interval schedule (Req 3.1, 3.3, 3.5)', () => {
    it('produces one occurrence per step across the window', async () => {
      const activity = await makeActivity({ type_key: 'water', duration_minutes: 1 });
      // A fixed window rather than one relative to now, so the expected count is arithmetic rather
      // than a guess: 08:00 to 20:00 every 120 minutes is 08, 10, 12, 14, 16, 18, 20 — seven.
      const schedule = await makeSchedule(activity, {
        kind: 'every',
        window_start: '08:00',
        window_end: '20:00',
        interval_minutes: 120,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      });

      // A window wide enough to contain any whole local day wherever the test runs.
      const found = (await occurrences(-60 * 36, 60 * 36)).filter(
        (row) => row.schedule_id === schedule,
      );

      // Three local days are generated, so three days' worth fall inside a 72-hour window.
      expect(found.length % 7).toBe(0);
      expect(found.length).toBeGreaterThanOrEqual(7);
    });

    it('never places an occurrence past the window end', async () => {
      // Requirement 3.5. A fixed zone, so the expected times are arithmetic rather than dependent on
      // wherever this test happens to run.
      await setZone('Africa/Nairobi');
      const activity = await makeActivity({ type_key: 'water', duration_minutes: 1 });
      // 150 minutes from 08:00 gives 08:00, 10:30, 13:00, 15:30, 18:00 — and then 20:30, which is past
      // the 20:00 end. generate_series must stop before it.
      const schedule = await makeSchedule(activity, {
        kind: 'every',
        window_start: '08:00',
        window_end: '20:00',
        interval_minutes: 150,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      });

      const asOf = '2026-06-15T09:00:00Z';
      const rows = (await occurrencesAsOf(asOf)).filter((row) => row.schedule_id === schedule);

      // One local day's worth, picked out of the three the function generates.
      const day = localDate(asOf, 'Africa/Nairobi');
      const times = rows
        .filter((row) => localDate(row.due_at, 'Africa/Nairobi') === day)
        .map((row) => wallClock(row.due_at, 'Africa/Nairobi'))
        .sort();

      expect(times).toEqual(['08:00', '10:30', '13:00', '15:30', '18:00']);
    });
  });

  describe('time zones (Req 8.1, 8.3)', () => {
    it('places the same wall-clock time differently in two zones', async () => {
      const activity = await makeActivity();
      const schedule = await makeSchedule(activity, {
        kind: 'at',
        local_time: '09:00',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      });

      const utcOffsetFor = async (zone: string) => {
        await setZone(zone);
        const found = (await occurrences(-60 * 36, 60 * 36)).filter(
          (row) => row.schedule_id === schedule,
        );
        expect(found.length).toBeGreaterThan(0);
        // The UTC hour that 09:00 local maps to. Different zone, different hour.
        return new Date(found[0]!.due_at).getUTCHours();
      };

      const nairobi = await utcOffsetFor('Africa/Nairobi'); // UTC+3 all year
      const london = await utcOffsetFor('Europe/London'); // UTC+0 or +1
      expect(nairobi).not.toBe(london);
    });

    it('survives a daylight saving transition without duplicating or skipping a day', async () => {
      /*
       * The case this whole design is arranged around. Europe/London moved its clocks on 2026-03-29.
       *
       * A 09:00 schedule must produce exactly one occurrence on each of the days either side, and the UTC
       * instant must differ between them — because 09:00 local is 09:00 UTC before the change and 08:00 UTC
       * after. Asserting the count catches a duplicate or a gap; asserting the shift catches arithmetic that
       * ignored the transition entirely.
       *
       * Driven through SQL rather than by moving the test's clock, so it exercises the same `at time zone`
       * path the scheduler uses.
       */
      await setZone('Europe/London');
      const activity = await makeActivity();
      const schedule = await makeSchedule(activity, {
        kind: 'at',
        local_time: '09:00',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      });

      const zone = 'Europe/London';
      const dayBefore = '2026-03-28';
      const dayAfter = '2026-03-30';

      // Asked of the real function on each side of the transition, via `as_of`.
      const before = (await occurrencesAsOf(`${dayBefore}T12:00:00Z`)).filter(
        (row) => row.schedule_id === schedule && localDate(row.due_at, zone) === dayBefore,
      );
      const after = (await occurrencesAsOf(`${dayAfter}T12:00:00Z`)).filter(
        (row) => row.schedule_id === schedule && localDate(row.due_at, zone) === dayAfter,
      );

      // Exactly one each. A duplicate would mean the transition was counted twice; none would mean a
      // day was skipped. Both are the classic failures here.
      expect(before).toHaveLength(1);
      expect(after).toHaveLength(1);

      // Still 09:00 on the wall clock, which is the promise made to the user.
      expect(wallClock(before[0]!.due_at, zone)).toBe('09:00');
      expect(wallClock(after[0]!.due_at, zone)).toBe('09:00');

      // And a different UTC instant, which is what proves the conversion actually happened rather than
      // the wall-clock time being stored and handed back unchanged.
      expect(new Date(before[0]!.due_at).getUTCHours()).toBe(9); // GMT
      expect(new Date(after[0]!.due_at).getUTCHours()).toBe(8); // BST
    });
  });
});
