/**
 * The notification queue, as built by the trigger on `fasts`. Requirements 5.3, 7.4, 7.5, 7.6.
 *
 * These are the tests that matter most for the app's headline feature. Sending is task 20; this is
 * about the rows being right, which is both easier to test and the half that goes wrong quietly. A
 * missing row means a notification that never arrives, and nothing reports an error.
 *
 * Read as the signed-in user throughout, because `notifications` has a select policy, and written
 * only by starting and editing fasts, because that is the only path the app has.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { STAGES } from '@fastr/shared';
import {
  SEED_USERS,
  hasStack,
  localStack,
  resetUserData,
  serviceClient,
  signedInClient,
  type LocalStack,
} from './helpers.js';

interface QueuedRow {
  kind: string;
  stage_key: string | null;
  due_at: string;
  status: string;
  fast_id: string | null;
}

describe.skipIf(!hasStack())('notification queueing', () => {
  let stack: LocalStack;
  let user: SupabaseClient;
  let service: SupabaseClient;
  const userId = SEED_USERS.a.id;

  beforeAll(async () => {
    stack = localStack()!;
    service = serviceClient(stack);
    user = await signedInClient(stack, 'a');
  });

  afterAll(async () => {
    await resetUserData(stack);
    await setPrefs({ notify_goal: true, notify_stages: false, notify_hour_before: false });
  });

  beforeEach(async () => {
    await resetUserData(stack);
  });

  async function setPrefs(prefs: Record<string, boolean>) {
    const { error } = await service.from('profiles').update(prefs).eq('id', userId);
    expect(error).toBeNull();
  }

  /** Starts an active fast, by default beginning now. Returns its id. */
  async function startFast(
    goalMinutes = 960,
    startAt: Date = new Date(),
  ): Promise<{ id: string; error: string | null }> {
    const { data, error } = await user
      .from('fasts')
      .insert({
        user_id: userId,
        plan_id: '16:8',
        goal_minutes: goalMinutes,
        start_at: startAt.toISOString(),
        status: 'active',
      })
      .select('id')
      .maybeSingle();
    return { id: (data as { id: string } | null)?.id ?? '', error: error?.message ?? null };
  }

  async function queued(fastId?: string): Promise<QueuedRow[]> {
    let query = user
      .from('notifications')
      .select('kind, stage_key, due_at, status, fast_id')
      .order('due_at');
    if (fastId) query = query.eq('fast_id', fastId);
    const { data, error } = await query;
    expect(error).toBeNull();
    return (data ?? []) as QueuedRow[];
  }

  const pending = (rows: QueuedRow[]) => rows.filter((row) => row.status === 'pending');

  describe('starting a fast', () => {
    it('queues the goal notification when that preference is on', async () => {
      await setPrefs({ notify_goal: true, notify_stages: false, notify_hour_before: false });
      const start = new Date();
      const { id } = await startFast(960, start);

      const rows = pending(await queued(id));
      expect(rows.map((row) => row.kind)).toEqual(['goal']);

      // Due exactly one goal-length after the start, to the second.
      const due = new Date(rows[0]!.due_at).getTime();
      expect(due).toBeCloseTo(start.getTime() + 960 * 60_000, -3);
    });

    it('queues nothing when every preference is off', async () => {
      await setPrefs({ notify_goal: false, notify_stages: false, notify_hour_before: false });
      const { id } = await startFast();
      expect(pending(await queued(id))).toEqual([]);
    });

    it('queues the hour-before notification an hour ahead of the goal', async () => {
      await setPrefs({ notify_goal: true, notify_stages: false, notify_hour_before: true });
      const { id } = await startFast(960);

      const rows = pending(await queued(id));
      expect(rows.map((row) => row.kind)).toEqual(['hour_before', 'goal']);

      const gap = new Date(rows[1]!.due_at).getTime() - new Date(rows[0]!.due_at).getTime();
      expect(gap).toBe(3_600_000);
    });

    it('queues only the stages that fall inside the goal', async () => {
      // Requirement 7.4. A 16-hour fast must not announce ketosis, which is at 18 hours.
      await setPrefs({ notify_goal: false, notify_stages: true, notify_hour_before: false });
      const { id } = await startFast(16 * 60);

      const keys = pending(await queued(id)).map((row) => row.stage_key);
      expect(keys).toEqual(['blood_sugar_falling', 'blood_sugar_normal', 'fat_burning']);
    });

    it('includes a stage landing exactly on the goal, and never the stage at zero', async () => {
      await setPrefs({ notify_goal: false, notify_stages: true, notify_hour_before: false });
      const { id } = await startFast(12 * 60); // fat_burning is at exactly 12h

      const keys = pending(await queued(id)).map((row) => row.stage_key);
      expect(keys.at(-1)).toBe('fat_burning');
      expect(keys).not.toContain('blood_sugar_rising'); // the 0h stage
    });

    it('queues every stage for a 72-hour fast', async () => {
      await setPrefs({ notify_goal: false, notify_stages: true, notify_hour_before: false });
      const { id } = await startFast(72 * 60);

      const expected = STAGES.filter((stage) => stage.atMinutes > 0).map((stage) => stage.key);
      expect(pending(await queued(id)).map((row) => row.stage_key)).toEqual(expected);
    });

    it('skips stages already passed on a backdated start', async () => {
      // Started 6 hours ago: the 2h and 5h stages are already behind us, so queueing them would fire
      // two alerts the moment the fast begins.
      await setPrefs({ notify_goal: true, notify_stages: true, notify_hour_before: false });
      const start = new Date(Date.now() - 6 * 3_600_000);
      const { id } = await startFast(16 * 60, start);

      const keys = pending(await queued(id))
        .filter((row) => row.kind === 'stage')
        .map((row) => row.stage_key);
      expect(keys).toEqual(['fat_burning']);
    });
  });

  describe('time limits (Req 5.3)', () => {
    it('refuses a fast starting in the future', async () => {
      const { error } = await startFast(960, new Date(Date.now() + 2 * 3_600_000));
      expect(error).toMatch(/cannot start in the future/);
    });

    it('accepts a start backdated within 48 hours', async () => {
      const { error } = await startFast(960, new Date(Date.now() - 47 * 3_600_000));
      expect(error).toBeNull();
    });

    it('refuses starting a fast backdated beyond 48 hours', async () => {
      const { error } = await startFast(960, new Date(Date.now() - 49 * 3_600_000));
      expect(error).toMatch(/more than 48 hours ago/);
    });

    it('still allows a finished fast to be logged from months ago', async () => {
      // Requirement 9.4. The 48-hour limit is about starting a fast, not about logging history, and
      // conflating the two would make "add a past fast" refuse anything older than two days.
      const start = new Date(Date.now() - 90 * 86_400_000);
      const { error } = await user.from('fasts').insert({
        user_id: userId,
        plan_id: '16:8',
        goal_minutes: 960,
        start_at: start.toISOString(),
        ended_at: new Date(start.getTime() + 16 * 3_600_000).toISOString(),
        status: 'completed',
      });
      expect(error).toBeNull();
    });
  });

  describe('editing a fast', () => {
    it('reschedules the queue when the start time moves', async () => {
      await setPrefs({ notify_goal: true, notify_stages: false, notify_hour_before: false });
      const { id } = await startFast(960, new Date(Date.now() - 3_600_000));
      const before = pending(await queued(id))[0]!.due_at;

      const moved = new Date(Date.now() - 30 * 60_000);
      const { error } = await user
        .from('fasts')
        .update({ start_at: moved.toISOString() })
        .eq('id', id);
      expect(error).toBeNull();

      const after = pending(await queued(id));
      expect(after).toHaveLength(1);
      expect(after[0]!.due_at).not.toBe(before);
      expect(new Date(after[0]!.due_at).getTime()).toBeCloseTo(moved.getTime() + 960 * 60_000, -3);

      // The old row is cancelled rather than removed, so what was scheduled stays auditable.
      const all = await queued(id);
      expect(all.filter((row) => row.status === 'cancelled')).toHaveLength(1);
    });

    it('reschedules when the goal changes', async () => {
      await setPrefs({ notify_goal: true, notify_stages: false, notify_hour_before: false });
      const start = new Date();
      const { id } = await startFast(960, start);

      await user.from('fasts').update({ goal_minutes: 1080 }).eq('id', id);

      const rows = pending(await queued(id));
      expect(rows).toHaveLength(1);
      expect(new Date(rows[0]!.due_at).getTime()).toBeCloseTo(start.getTime() + 1080 * 60_000, -3);
    });

    it('cancels everything when the fast ends', async () => {
      await setPrefs({ notify_goal: true, notify_stages: true, notify_hour_before: true });
      const { id } = await startFast(960);
      expect(pending(await queued(id)).length).toBeGreaterThan(1);

      const { error } = await user
        .from('fasts')
        .update({ status: 'completed', ended_at: new Date().toISOString() })
        .eq('id', id);
      expect(error).toBeNull();

      expect(pending(await queued(id))).toEqual([]);
    });

    it('cancels everything when the fast is ended early', async () => {
      await setPrefs({ notify_goal: true, notify_stages: false, notify_hour_before: false });
      const { id } = await startFast(960);

      await user
        .from('fasts')
        .update({ status: 'ended_early', ended_at: new Date().toISOString() })
        .eq('id', id);

      expect(pending(await queued(id))).toEqual([]);
    });

    it('leaves the queue alone when only a note changes', async () => {
      // The trigger is scoped to start_at, goal_minutes and status. Editing a mood rating should not
      // tear the queue down and rebuild it, which would show up as a cancelled row per edit.
      await setPrefs({ notify_goal: true, notify_stages: false, notify_hour_before: false });
      const { id } = await startFast(960);
      const before = await queued(id);

      await user.from('fasts').update({ note: 'feeling fine', mood: 4 }).eq('id', id);

      expect(await queued(id)).toEqual(before);
    });

    it('does not queue a duplicate when the same edit is applied twice', async () => {
      // Requirement 7.7's unique index, reached through `on conflict do nothing`.
      await setPrefs({ notify_goal: true, notify_stages: false, notify_hour_before: false });
      const start = new Date();
      const { id } = await startFast(960, start);

      await user.from('fasts').update({ goal_minutes: 1020 }).eq('id', id);
      await user.from('fasts').update({ goal_minutes: 1020 }).eq('id', id);

      expect(pending(await queued(id))).toHaveLength(1);
    });
  });

  describe('deleting a fast', () => {
    it('takes its notifications with it', async () => {
      await setPrefs({ notify_goal: true, notify_stages: true, notify_hour_before: false });
      const { id } = await startFast(960);
      expect((await queued(id)).length).toBeGreaterThan(0);

      const { error } = await user.from('fasts').delete().eq('id', id);
      expect(error).toBeNull();

      // Through the cascade on notifications.fast_id, with no application code involved.
      const { data } = await service.from('notifications').select('id').eq('fast_id', id);
      expect(data).toEqual([]);
    });
  });

  describe('isolation', () => {
    it('queues against the owning user only', async () => {
      await setPrefs({ notify_goal: true, notify_stages: false, notify_hour_before: false });
      const { id } = await startFast(960);

      const other = await signedInClient(stack, 'b');
      const { data } = await other.from('notifications').select('id').eq('fast_id', id);
      expect(data).toEqual([]);
    });
  });
});
