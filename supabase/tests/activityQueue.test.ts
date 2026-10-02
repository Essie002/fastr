/**
 * Queueing and cancelling activity reminders. Requirements 2.4, 2.5, 3.4, 4.3, 4.4, 8.2.
 *
 * The claim that matters most here is idempotency. The scheduling job runs every fifteen minutes with a
 * twenty-minute lookahead, so consecutive runs see the same occurrence deliberately, and the only thing
 * stopping a duplicate is a partial unique index. A test that calls the function once proves nothing about
 * that; these call it repeatedly.
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

interface LocalNow {
  time: string;
  dow: number;
  date: string;
}

describe.skipIf(!hasStack())('queue_due_activities', () => {
  let stack: LocalStack;
  let service: SupabaseClient;
  const userId = SEED_USERS.a.id;

  beforeAll(() => {
    stack = localStack()!;
    service = serviceClient(stack);
  });

  afterAll(async () => {
    await resetUserData(stack);
    await service
      .from('profiles')
      .update({ time_zone: 'Africa/Nairobi', notify_activities: true })
      .eq('id', userId);
  });

  beforeEach(async () => {
    await resetUserData(stack);
    await service
      .from('profiles')
      .update({ time_zone: 'Africa/Nairobi', notify_activities: true })
      .eq('id', userId);
  });

  async function localNow(offsetMinutes = 0): Promise<LocalNow> {
    const { data, error } = await service.rpc('fastr_test_local_now', {
      user_id: userId,
      offset_minutes: offsetMinutes,
    });
    expect(error).toBeNull();
    return data as LocalNow;
  }

  async function makeActivity(overrides: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await service
      .from('activities')
      .insert({ user_id: userId, type_key: 'swim', duration_minutes: 45, ...overrides })
      .select('id')
      .single();
    expect(error).toBeNull();
    return (data as { id: string }).id;
  }

  async function makeSchedule(
    activityId: string,
    fields: Record<string, unknown>,
  ): Promise<string> {
    const { data, error } = await service
      .from('activity_schedules')
      .insert({ activity_id: activityId, user_id: userId, ...fields })
      .select('id')
      .single();
    expect(error).toBeNull();
    return (data as { id: string }).id;
  }

  async function queue(): Promise<number> {
    const { data, error } = await service.rpc('queue_due_activities');
    expect(error).toBeNull();
    return data as number;
  }

  async function notifications(kind?: string) {
    let query = service
      .from('notifications')
      .select('id, kind, status, due_at, activity_id, activity_schedule_id')
      .eq('user_id', userId);
    if (kind) query = query.eq('kind', kind);
    const { data, error } = await query;
    expect(error).toBeNull();
    return (data ?? []) as {
      id: string;
      kind: string;
      status: string;
      due_at: string;
      activity_id: string | null;
      activity_schedule_id: string | null;
    }[];
  }

  /** An activity with one wall-clock schedule due shortly, which is the common setup. */
  async function dueSoon(activityOverrides: Record<string, unknown> = {}) {
    const now = await localNow(10);
    const activity = await makeActivity(activityOverrides);
    const schedule = await makeSchedule(activity, {
      kind: 'at',
      local_time: now.time,
      weekdays: [now.dow],
    });
    return { activity, schedule };
  }

  it('queues a start notification for an occurrence falling due', async () => {
    const { activity, schedule } = await dueSoon();

    expect(await queue()).toBe(1);

    const rows = await notifications('activity_start');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.activity_id).toBe(activity);
    expect(rows[0]!.activity_schedule_id).toBe(schedule);
    expect(rows[0]!.status).toBe('pending');
  });

  it('is idempotent however many times it runs (Req 3.4)', async () => {
    await dueSoon();

    expect(await queue()).toBe(1);
    // The real cadence: overlapping windows mean the next three runs see the same occurrence.
    expect(await queue()).toBe(0);
    expect(await queue()).toBe(0);
    expect(await queue()).toBe(0);

    expect(await notifications('activity_start')).toHaveLength(1);
  });

  it('queues an end notification only when the activity asks for one (Req 4.3, 4.4)', async () => {
    await dueSoon({ notify_end: false });
    await queue();
    expect(await notifications('activity_end')).toHaveLength(0);

    await resetUserData(stack);

    const { activity } = await dueSoon({ notify_end: true, duration_minutes: 30 });
    await queue();

    const ends = await notifications('activity_end');
    expect(ends).toHaveLength(1);
    expect(ends[0]!.activity_id).toBe(activity);

    // Due exactly the activity's duration after the start.
    const starts = await notifications('activity_start');
    const gap = (Date.parse(ends[0]!.due_at) - Date.parse(starts[0]!.due_at)) / 60_000;
    expect(gap).toBe(30);
  });

  it('does not queue an occurrence long past (Req 2.5)', async () => {
    // Three hours ago, well outside the five-minute look-back. Enabling an activity in the evening must
    // not fire that morning's reminder.
    const past = await localNow(-180);
    const activity = await makeActivity();
    await makeSchedule(activity, { kind: 'at', local_time: past.time, weekdays: [past.dow] });

    expect(await queue()).toBe(0);
    expect(await notifications()).toHaveLength(0);
  });

  it('queues nothing when the master switch is off (Req 4.8)', async () => {
    await dueSoon();
    await service.from('profiles').update({ notify_activities: false }).eq('id', userId);

    expect(await queue()).toBe(0);
    expect(await notifications('activity_start')).toHaveLength(0);
  });

  describe('cancelling (Req 8.2)', () => {
    it('cancels pending notifications when the schedule is disabled', async () => {
      const { schedule } = await dueSoon();
      await queue();
      expect((await notifications('activity_start'))[0]!.status).toBe('pending');

      const { error } = await service
        .from('activity_schedules')
        .update({ enabled: false })
        .eq('id', schedule);
      expect(error).toBeNull();

      expect((await notifications('activity_start'))[0]!.status).toBe('cancelled');
    });

    it('cancels when the activity is disabled', async () => {
      const { activity } = await dueSoon();
      await queue();

      await service.from('activities').update({ enabled: false }).eq('id', activity);

      expect((await notifications('activity_start'))[0]!.status).toBe('cancelled');
    });

    it('leaves already-sent notifications alone, because they are history', async () => {
      const { schedule } = await dueSoon();
      await queue();
      const queued = (await notifications('activity_start'))[0]!;
      await service.from('notifications').update({ status: 'sent' }).eq('id', queued.id);

      await service.from('activity_schedules').update({ enabled: false }).eq('id', schedule);

      expect((await notifications('activity_start'))[0]!.status).toBe('sent');
    });

    it('cancels this user\u2019s pending activity notifications when their time zone changes', async () => {
      await dueSoon();
      await queue();

      const { error } = await service
        .from('profiles')
        .update({ time_zone: 'Europe/London' })
        .eq('id', userId);
      expect(error).toBeNull();

      expect((await notifications('activity_start'))[0]!.status).toBe('cancelled');
    });

    it('allows a cancelled occurrence to be queued again', async () => {
      // The index is scoped to pending and sent precisely so that disabling and re-enabling works. If it
      // covered cancelled rows too, changing your mind would silently lose the reminder.
      const { schedule } = await dueSoon();
      await queue();
      await service.from('activity_schedules').update({ enabled: false }).eq('id', schedule);
      await service.from('activity_schedules').update({ enabled: true }).eq('id', schedule);

      expect(await queue()).toBe(1);

      const rows = await notifications('activity_start');
      expect(rows.filter((row) => row.status === 'pending')).toHaveLength(1);
      expect(rows.filter((row) => row.status === 'cancelled')).toHaveLength(1);
    });
  });

  describe('interval schedules', () => {
    it('queues only the occurrences inside the window, not the whole day', async () => {
      // A 15-minute interval across the whole day is 96 occurrences; the function must queue only those
      // within its twenty-minute lookahead, or one run would fill the queue with tomorrow's reminders.
      const activity = await makeActivity({ type_key: 'water', duration_minutes: 1 });
      await makeSchedule(activity, {
        kind: 'every',
        window_start: '00:00',
        window_end: '23:45',
        interval_minutes: 15,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      });

      const count = await queue();
      // At most the lookahead window divided by the interval, plus the look-back. Two or three, never 96.
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(3);
    });
  });
});
