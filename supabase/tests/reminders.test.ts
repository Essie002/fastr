/**
 * Queueing reminders. Requirement 8.
 *
 * Tested against real Postgres because the whole function is a time-zone conversion, and that is precisely what a
 * mock cannot check: `at time zone` twice, across a daylight saving boundary, with the user's own calendar day.
 *
 * Every "what time is it there" question is asked of Postgres rather than computed here. Adding thirty minutes to a
 * wall-clock string in JavaScript wraps wrongly past midnight — 23:50 becomes 00:20, which reads as this morning and
 * lands twenty-three hours in the past — so the test would fail for one half-hour a day in one time zone. That flake
 * cost a build to find.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SEED_USERS,
  anonClient,
  hasStack,
  localStack,
  resetUserData,
  serviceClient,
  signedInClient,
  type LocalStack,
} from './helpers.js';

interface LocalNow {
  time: string;
  dow: number;
  date: string;
}

describe.skipIf(!hasStack())('queue_due_reminders', () => {
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
    await service.from('profiles').update({ time_zone: 'Africa/Nairobi' }).eq('id', userId);
  });

  /** The user's local wall clock, `offsetMinutes` from now, straight from Postgres. */
  async function localNow(offsetMinutes = 0): Promise<LocalNow> {
    const { data, error } = await service.rpc('fastr_test_local_now', {
      user_id: userId,
      offset_minutes: offsetMinutes,
    });
    expect(error).toBeNull();
    return data as LocalNow;
  }

  const queue = async () => {
    const { data, error } = await service.rpc('queue_due_reminders');
    expect(error).toBeNull();
    return data as number;
  };

  async function addReminder(localTime: string, weekdays: number[], enabled = true) {
    const { error } = await service
      .from('reminders')
      .insert({ user_id: userId, local_time: localTime, weekdays, enabled });
    expect(error).toBeNull();
  }

  async function pendingReminders() {
    const { data } = await service
      .from('notifications')
      .select('id, kind, due_at, status')
      .eq('kind', 'reminder');
    return data ?? [];
  }

  /**
   * A reminder set to the user's current local minute, which is inside the sweep's window by construction.
   *
   * Deliberately *not* "half an hour from now". The function only ever considers today's occurrence, so near local
   * midnight a reminder half an hour away belongs to tomorrow and is correctly left for tomorrow's run — which made
   * the obvious version of this helper fail for the last half-hour of every day, in whichever zone the test had set.
   * The behaviour it was tripping over is real and worth having its own test, below.
   */
  async function addReminderNow() {
    const here = await localNow(0);
    await addReminder(here.time, [here.dow]);
    return here;
  }

  it('queues a reminder due now', async () => {
    await addReminderNow();

    expect(await queue()).toBe(1);
    expect(await pendingReminders()).toHaveLength(1);
  });

  it('ignores a reminder for a different day of the week', async () => {
    const soon = await localNow(30);
    await addReminder(soon.time, [(soon.dow + 3) % 7]);

    expect(await queue()).toBe(0);
  });

  it('ignores a disabled reminder', async () => {
    const soon = await localNow(30);
    await addReminder(soon.time, [soon.dow], false);

    expect(await queue()).toBe(0);
  });

  it('ignores a reminder still hours away, so an hourly run does not queue the whole day', async () => {
    const later = await localNow(5 * 60);
    await addReminder(later.time, [later.dow]);

    expect(await queue()).toBe(0);
  });

  it('ignores a reminder whose time has long passed', async () => {
    // The lower bound on the window. Without it, an evening run would queue this morning's reminder.
    const earlier = await localNow(-5 * 60);
    await addReminder(earlier.time, [earlier.dow]);

    expect(await queue()).toBe(0);
  });

  it('does not queue a reminder while a fast is already running (Req 8.3)', async () => {
    await addReminderNow();
    await service.from('fasts').insert({
      user_id: userId,
      plan_id: '16:8',
      goal_minutes: 960,
      start_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      status: 'active',
    });

    expect(await queue()).toBe(0);
  });

  it('queues at most one reminder per local day, however often it runs', async () => {
    await addReminderNow();

    expect(await queue()).toBe(1);
    // An hourly job runs twenty-four times a day; a second row would mean a second notification.
    expect(await queue()).toBe(0);
    expect(await pendingReminders()).toHaveLength(1);
  });

  it('resolves the time in the user zone rather than the server zone (Req 8.4)', async () => {
    // The point of storing an IANA name. Auckland is up to thirteen hours from the server's clock, so a function
    // using the server zone would compute a due time half a day out and queue nothing.
    await service.from('profiles').update({ time_zone: 'Pacific/Auckland' }).eq('id', userId);

    await addReminderNow();

    expect(await queue()).toBe(1);
  });

  it('works for a zone behind the server as well as ahead of it', async () => {
    await service.from('profiles').update({ time_zone: 'America/Los_Angeles' }).eq('id', userId);

    await addReminderNow();

    expect(await queue()).toBe(1);
  });

  it('leaves a reminder that falls after local midnight to the next run', async () => {
    /*
     * Documented because it looks like a gap and is not one.
     *
     * The sweep only ever considers today's occurrence in the user's zone. So at 23:40 local, a 00:10 reminder is not
     * queued — its due time today is sixteen hours in the past, and tomorrow's is outside the window. The run at
     * 00:00 catches it, ten minutes early, and the sender fires it on time.
     *
     * Asserted by constructing exactly that situation: a reminder ten minutes past local midnight, on tomorrow's
     * weekday, queued while today is still today.
     */
    const afterMidnight = await localNow(0);
    const tomorrowDow = (afterMidnight.dow + 1) % 7;
    await addReminder('00:10', [tomorrowDow]);

    expect(await queue()).toBe(0);
  });

  it('cannot be called by a signed-in user', async () => {
    const user = await signedInClient(stack, 'a');
    const { error } = await user.rpc('queue_due_reminders');
    expect(error).not.toBeNull();
  });

  it('cannot be called anonymously', async () => {
    const anon = anonClient(stack);
    const { error } = await anon.rpc('queue_due_reminders');
    expect(error).not.toBeNull();
  });
});
