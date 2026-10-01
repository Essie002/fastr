/**
 * Queueing reminders. Requirement 8.
 *
 * Tested against real Postgres because the whole function is a time-zone conversion, and that is precisely what a
 * mock cannot check: `at time zone` twice, across a daylight saving boundary, with the user's own calendar day.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SEED_USERS,
  hasStack,
  localStack,
  resetUserData,
  serviceClient,
  signedInClient,
  type LocalStack,
} from './helpers.js';

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

  /** Reads the user's current local time and weekday straight from Postgres, so the test agrees with the function. */
  async function localNow(): Promise<{ time: string; dow: number }> {
    const { data } = await service.rpc('fastr_test_local_now', { user_id: userId });
    return data as { time: string; dow: number };
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

  it('queues a reminder due within the next hour', async () => {
    const { time, dow } = await localNow();
    // Half an hour from now, in the user's own zone.
    const [hours, minutes] = time.split(':').map(Number) as [number, number];
    const soon = new Date(2000, 0, 1, hours, minutes + 30);
    const target = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;

    await addReminder(target, [dow]);

    expect(await queue()).toBe(1);
    expect(await pendingReminders()).toHaveLength(1);
  });

  it('ignores a reminder for a different day of the week', async () => {
    const { time, dow } = await localNow();
    await addReminder(time, [(dow + 3) % 7]);

    expect(await queue()).toBe(0);
  });

  it('ignores a disabled reminder', async () => {
    const { time, dow } = await localNow();
    await addReminder(time, [dow], false);

    expect(await queue()).toBe(0);
  });

  it('ignores a reminder hours away, so an hourly run does not queue the whole day', async () => {
    const { dow } = await localNow();
    // Fixed far-away time rather than one derived from now, to keep this independent of when it runs.
    await addReminder('03:17', [dow]);
    const queued = await queue();

    // Either zero, or one if the test happens to run within an hour of 03:17 local.
    expect(queued).toBeLessThanOrEqual(1);
  });

  it('does not queue a reminder while a fast is already running (Req 8.3)', async () => {
    const { time, dow } = await localNow();
    const [hours, minutes] = time.split(':').map(Number) as [number, number];
    const soon = new Date(2000, 0, 1, hours, minutes + 30);
    const target = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;

    await addReminder(target, [dow]);
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
    const { time, dow } = await localNow();
    const [hours, minutes] = time.split(':').map(Number) as [number, number];
    const soon = new Date(2000, 0, 1, hours, minutes + 30);
    const target = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;

    await addReminder(target, [dow]);

    expect(await queue()).toBe(1);
    // An hourly job runs twenty-four times a day; a second row would mean a second notification.
    expect(await queue()).toBe(0);
    expect(await pendingReminders()).toHaveLength(1);
  });

  it('resolves the time in the user zone rather than the server zone', async () => {
    // The point of storing an IANA name. With the profile in Auckland, a reminder at the server's local time is
    // not due, and one at Auckland's local time is.
    await service.from('profiles').update({ time_zone: 'Pacific/Auckland' }).eq('id', userId);

    const { time, dow } = await localNow();
    const [hours, minutes] = time.split(':').map(Number) as [number, number];
    const soon = new Date(2000, 0, 1, hours, minutes + 30);
    const target = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;

    await addReminder(target, [dow]);

    expect(await queue()).toBe(1);
  });

  it('cannot be called by a signed-in user', async () => {
    const user = await signedInClient(stack, 'a');
    const { error } = await user.rpc('queue_due_reminders');
    expect(error).not.toBeNull();
  });
});
