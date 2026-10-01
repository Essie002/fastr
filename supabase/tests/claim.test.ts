/**
 * The claiming statement. Requirement 7.7.
 *
 * This is the piece that decides whether a notification can be sent twice, so it is tested against a real
 * Postgres: `for update skip locked` has no meaningful mock, and the behaviour under two concurrent callers is
 * the entire point.
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

interface Claimed {
  id: string;
  kind: string;
  status: string;
}

describe.skipIf(!hasStack())('claim_due_notifications', () => {
  let stack: LocalStack;
  let service: SupabaseClient;
  const userId = SEED_USERS.a.id;

  beforeAll(() => {
    stack = localStack()!;
    service = serviceClient(stack);
  });

  afterAll(async () => {
    await resetUserData(stack);
  });

  beforeEach(async () => {
    await resetUserData(stack);
  });

  /** Queues a reminder notification due `minutesFromNow` from now. Reminders need no parent fast. */
  async function queue(minutesFromNow: number): Promise<string> {
    const { data, error } = await service
      .from('notifications')
      .insert({
        user_id: userId,
        kind: 'reminder',
        due_at: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
        status: 'pending',
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    return (data as { id: string }).id;
  }

  const claim = async (batch = 200) =>
    service.rpc('claim_due_notifications', { batch_size: batch });

  it('claims a notification that is due', async () => {
    const id = await queue(-1);

    const { data, error } = await claim();
    expect(error).toBeNull();
    expect((data as Claimed[]).map((row) => row.id)).toContain(id);
  });

  it('leaves a notification that is not due yet', async () => {
    await queue(60);

    const { data } = await claim();
    expect(data).toEqual([]);
  });

  it('marks what it claims as sent, before any delivery is attempted', async () => {
    // Deliberately pessimistic: a missed alert beats a duplicate at three in the morning.
    const id = await queue(-1);
    await claim();

    const { data } = await service
      .from('notifications')
      .select('status, attempts')
      .eq('id', id)
      .single();
    expect((data as { status: string }).status).toBe('sent');
    expect((data as { attempts: number }).attempts).toBe(1);
  });

  it('does not claim the same row twice', async () => {
    const id = await queue(-1);

    const first = await claim();
    const second = await claim();

    expect((first.data as Claimed[]).map((row) => row.id)).toContain(id);
    expect((second.data as Claimed[]).map((row) => row.id)).not.toContain(id);
  });

  it('hands a row to exactly one of two concurrent callers', async () => {
    // The case the whole design exists for: cron fires every minute, and a run that takes longer than a minute
    // overlaps the next one.
    const id = await queue(-1);

    const [first, second] = await Promise.all([claim(), claim()]);

    const claimedIds = [
      ...(first.data as Claimed[]).map((row) => row.id),
      ...(second.data as Claimed[]).map((row) => row.id),
    ];
    expect(claimedIds.filter((claimedId) => claimedId === id)).toHaveLength(1);
  });

  it('claims many rows across two concurrent callers without duplicating any', async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => queue(-1)));

    const [first, second] = await Promise.all([claim(5), claim(5)]);

    const claimedIds = [
      ...(first.data as Claimed[]).map((row) => row.id),
      ...(second.data as Claimed[]).map((row) => row.id),
    ];
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    for (const claimedId of claimedIds) expect(ids).toContain(claimedId);
  });

  it('honours the batch size, so one run cannot overrun its minute', async () => {
    await Promise.all(Array.from({ length: 10 }, () => queue(-1)));

    const { data } = await claim(3);
    expect((data as Claimed[]).length).toBe(3);
  });

  it('takes the oldest first, so a catch-up run does not starve the earliest alerts', async () => {
    const oldest = await queue(-30);
    await queue(-2);
    await queue(-1);

    const { data } = await claim(1);
    expect((data as Claimed[])[0]?.id).toBe(oldest);
  });

  it('ignores rows that are cancelled or already sent', async () => {
    const id = await queue(-1);
    await service.from('notifications').update({ status: 'cancelled' }).eq('id', id);

    const { data } = await claim();
    expect((data as Claimed[]).map((row) => row.id)).not.toContain(id);
  });

  it('cannot be called by a signed-in user', async () => {
    // A user who could claim their own notifications could silently cancel them — and anyone else's.
    const user = await signedInClient(stack, 'a');
    const { error } = await user.rpc('claim_due_notifications', { batch_size: 10 });
    expect(error).not.toBeNull();
  });

  it('cannot be called anonymously', async () => {
    const { anonClient } = await import('./helpers.js');
    const anon = anonClient(stack);
    const { error } = await anon.rpc('claim_due_notifications', { batch_size: 10 });
    expect(error).not.toBeNull();
  });
});

describe.skipIf(!hasStack())('bump_push_failures', () => {
  let stack: LocalStack;
  let service: SupabaseClient;

  beforeAll(() => {
    stack = localStack()!;
    service = serviceClient(stack);
  });

  beforeEach(async () => {
    await resetUserData(stack);
  });

  afterAll(async () => {
    await resetUserData(stack);
  });

  it('increments without reading first, so two runs cannot race', async () => {
    const { data } = await service
      .from('push_subscriptions')
      .insert({
        user_id: SEED_USERS.a.id,
        endpoint: 'https://push.example.test/claim-test',
        p256dh: 'a',
        auth: 'b',
      })
      .select('id')
      .single();
    const id = (data as { id: string }).id;

    await Promise.all([
      service.rpc('bump_push_failures', { ids: [id] }),
      service.rpc('bump_push_failures', { ids: [id] }),
    ]);

    const { data: after } = await service
      .from('push_subscriptions')
      .select('failures')
      .eq('id', id)
      .single();
    expect((after as { failures: number }).failures).toBe(2);
  });

  it('cannot be called by a signed-in user', async () => {
    const user = await signedInClient(stack, 'a');
    const { error } = await user.rpc('bump_push_failures', { ids: [] });
    expect(error).not.toBeNull();
  });
});
