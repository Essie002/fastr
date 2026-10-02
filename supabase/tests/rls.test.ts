/**
 * Proof that one user cannot reach another's data. Requirement 18.2.
 *
 * This is the most important suite in the project. There is no application server: the browser holds
 * a published anon key and talks to Postgres directly, so these policies are the only thing between
 * two accounts. Everything else here is a feature; this is the security boundary.
 *
 * The shape of every test is the same. A row is planted for user A with the service role, which
 * bypasses RLS. Then user B, holding a real JWT, tries each of select, insert, update and delete
 * against it. The service role is used only to plant and to verify afterwards, never to assert that
 * something was blocked, because it cannot be blocked.
 *
 * Two failure modes this suite is written to catch, both of which look like success:
 *
 *   - A blocked `select` returns an empty list, not an error. A test asserting "no error" would pass
 *     against a table with no policy at all.
 *   - A blocked `update` or `delete` also reports success with zero rows affected. So each one is
 *     confirmed by reading the row back with the service role and checking it is unchanged.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SEED_USERS,
  USER_TABLES,
  anonClient,
  hasStack,
  localStack,
  resetUserData,
  sampleRow,
  serviceClient,
  signedInClient,
  type LocalStack,
  type UserTable,
} from './helpers.js';

describe.skipIf(!hasStack())('Row Level Security', () => {
  let stack: LocalStack;
  let service: SupabaseClient;
  let userA: SupabaseClient;
  let userB: SupabaseClient;

  beforeAll(async () => {
    stack = localStack()!;
    service = serviceClient(stack);
    userA = await signedInClient(stack, 'a');
    userB = await signedInClient(stack, 'b');
  });

  afterAll(async () => {
    await resetUserData(stack);
  });

  beforeEach(async () => {
    await resetUserData(stack);
  });

  it('signs in as two genuinely different users', async () => {
    // If this fails, every isolation test below is meaningless, so it is asserted rather than assumed.
    const a = await userA.auth.getUser();
    const b = await userB.auth.getUser();
    expect(a.data.user?.id).toBe(SEED_USERS.a.id);
    expect(b.data.user?.id).toBe(SEED_USERS.b.id);
    expect(a.data.user?.id).not.toBe(b.data.user?.id);
  });

  describe.each(USER_TABLES)('%s', (table: UserTable) => {
    /** A row belonging to user A, planted past RLS. Returns its id. */
    async function plantForA(seed: number): Promise<string> {
      const { data, error } = await service
        .from(table)
        .insert(sampleRow(table, SEED_USERS.a.id, seed))
        .select('id')
        .single();
      expect(error, `planting a fixture in ${table} should succeed`).toBeNull();
      return (data as { id: string }).id;
    }

    it('lets the owner read their own row', async () => {
      // The control. Without it, a suite where every read returns nothing would look like perfect
      // isolation while the app was simply broken.
      const id = await plantForA(1);
      const { data, error } = await userA.from(table).select('id').eq('id', id);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('hides the row from the other user', async () => {
      const id = await plantForA(2);
      const { data, error } = await userB.from(table).select('id').eq('id', id);
      // An empty result, not an error: RLS filters rather than refuses.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('hides the row from an unauthenticated client', async () => {
      const id = await plantForA(3);
      const anon = anonClient(stack);
      const { data } = await anon.from(table).select('id').eq('id', id);
      expect(data ?? []).toEqual([]);
    });

    it('refuses an insert on behalf of the other user', async () => {
      if (table === 'notifications') {
        // Select-only by design, covered separately below.
        return;
      }
      const { error } = await userB.from(table).insert(sampleRow(table, SEED_USERS.a.id, 4));
      expect(error, 'inserting a row owned by another user must fail').not.toBeNull();
      expect(error?.code).toBe('42501'); // insufficient_privilege

      const { count } = await service
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', SEED_USERS.a.id);
      expect(count ?? 0).toBe(0);
    });

    it("cannot update the other user's row", async () => {
      const id = await plantForA(5);
      const before = await service.from(table).select('*').eq('id', id).single();

      await userB.from(table).update(mutationFor(table)).eq('id', id);

      // The update reports success with zero rows matched, so the row itself is the evidence.
      const after = await service.from(table).select('*').eq('id', id).single();
      expect(after.data).toEqual(before.data);
    });

    it("cannot delete the other user's row", async () => {
      const id = await plantForA(6);

      await userB.from(table).delete().eq('id', id);

      const { data } = await service.from(table).select('id').eq('id', id);
      expect(data, `${table} row must survive a delete by another user`).toHaveLength(1);
    });

    it('does not leak the row through an unfiltered select', async () => {
      // A policy that only matched on an explicit `eq('id', ...)` would pass every test above and
      // still hand over the whole table here.
      await plantForA(7);
      const { data } = await userB.from(table).select('user_id');
      const foreign = (data ?? []).filter(
        (row) => (row as { user_id: string }).user_id === SEED_USERS.a.id,
      );
      expect(foreign).toEqual([]);
    });
  });

  describe('the reassignment hole', () => {
    it('will not let a user hand their own row to somebody else', async () => {
      // This is what `with check` on an update policy prevents. With only `using`, the row passes the
      // check on the way in, gets a new user_id, and disappears from its owner's account into
      // another's. Every table here follows the same policy shape, so fasts stands for all of them.
      const { data: mine, error: insertError } = await userA
        .from('fasts')
        .insert(sampleRow('fasts', SEED_USERS.a.id, 8))
        .select('id')
        .single();
      expect(insertError).toBeNull();
      const id = (mine as { id: string }).id;

      await userA.from('fasts').update({ user_id: SEED_USERS.b.id }).eq('id', id);

      /*
       * The row is the assertion, not the error code.
       *
       * A refused update surfaces two ways: a `with check` violation (42501) when the row is visible to the caller, or
       * plain success with zero rows matched when `using` filtered it out first. Which one happens depends on the data
       * present, so asserting the code made this test pass or fail according to what other suites had left behind — it
       * failed in a full run and passed in isolation. What must hold either way is that the row still belongs to its
       * owner.
       */
      const { data } = await service.from('fasts').select('user_id').eq('id', id).single();
      expect((data as { user_id: string }).user_id, 'reassigning user_id must not succeed').toBe(
        SEED_USERS.a.id,
      );
    });
  });

  describe('profiles', () => {
    it('shows a user only their own profile', async () => {
      const { data } = await userB.from('profiles').select('id, display_name');
      expect(data).toHaveLength(1);
      expect((data as { id: string }[])[0]?.id).toBe(SEED_USERS.b.id);
    });

    it('lets a user update their own profile', async () => {
      const { error } = await userB
        .from('profiles')
        .update({ theme: 'dark' })
        .eq('id', SEED_USERS.b.id);
      expect(error).toBeNull();
      const { data } = await userB
        .from('profiles')
        .select('theme')
        .eq('id', SEED_USERS.b.id)
        .single();
      expect((data as { theme: string }).theme).toBe('dark');
      await userB.from('profiles').update({ theme: 'system' }).eq('id', SEED_USERS.b.id);
    });

    it("cannot update the other user's profile", async () => {
      const before = await service
        .from('profiles')
        .select('display_name')
        .eq('id', SEED_USERS.a.id)
        .single();

      await userB.from('profiles').update({ display_name: 'hijacked' }).eq('id', SEED_USERS.a.id);

      const after = await service
        .from('profiles')
        .select('display_name')
        .eq('id', SEED_USERS.a.id)
        .single();
      expect(after.data).toEqual(before.data);
    });

    it('cannot insert or delete a profile at all', async () => {
      // No insert or delete policy exists: rows come from the trigger on auth.users and go with the
      // cascade. A client doing either would mean an account without settings, or settings without
      // an account.
      const insert = await userB
        .from('profiles')
        .insert({ id: crypto.randomUUID(), display_name: 'ghost' });
      expect(insert.error).not.toBeNull();

      await userB.from('profiles').delete().eq('id', SEED_USERS.b.id);
      const { data } = await service.from('profiles').select('id').eq('id', SEED_USERS.b.id);
      expect(data).toHaveLength(1);
    });
  });

  describe('notifications', () => {
    it('is readable but not writable by its owner', async () => {
      // The client can see what is queued, which settings uses, and can change nothing. A client that
      // could insert here could make the server push arbitrary messages to its own devices; one that
      // could update could mark somebody else's notification sent.
      const { error: insertError } = await userA
        .from('notifications')
        .insert(sampleRow('notifications', SEED_USERS.a.id, 9));
      expect(insertError).not.toBeNull();
      expect(insertError?.code).toBe('42501');

      const id = await (async () => {
        const { data } = await service
          .from('notifications')
          .insert(sampleRow('notifications', SEED_USERS.a.id, 10))
          .select('id')
          .single();
        return (data as { id: string }).id;
      })();

      const { data: visible } = await userA.from('notifications').select('id').eq('id', id);
      expect(visible).toHaveLength(1);

      await userA.from('notifications').update({ status: 'sent' }).eq('id', id);
      const { data: after } = await service
        .from('notifications')
        .select('status')
        .eq('id', id)
        .single();
      expect((after as { status: string }).status).toBe('pending');
    });
  });

  /**
   * `activity_schedules` on its own, because it cannot be in the generic suite above: a schedule needs a
   * parent activity, so there is no minimal standalone row for `sampleRow` to return.
   *
   * It also has something no other table has — a denormalised `user_id` that RLS trusts and a trigger owns.
   * That combination is worth testing directly: if a client could set that column, it could file a schedule
   * under someone else's id, and the row would then be invisible to its real owner while queueing
   * notifications attributed to a stranger.
   */
  describe('activity_schedules', () => {
    /** An activity owned by the given client, returning its id. */
    async function activityFor(client: SupabaseClient): Promise<string> {
      const { data, error } = await client
        .from('activities')
        .insert({
          user_id: (await client.auth.getUser()).data.user!.id,
          type_key: 'swim',
          duration_minutes: 45,
        })
        .select('id')
        .single();
      expect(error).toBeNull();
      return (data as { id: string }).id;
    }

    it('lets a user create a schedule on their own activity', async () => {
      const activity = await activityFor(userA);
      const { error } = await userA.from('activity_schedules').insert({
        activity_id: activity,
        kind: 'at',
        local_time: '07:00',
        weekdays: [1],
      });
      expect(error).toBeNull();
    });

    it('refuses a schedule on someone else\u2019s activity', async () => {
      const activityOfA = await activityFor(userA);

      const { error } = await userB.from('activity_schedules').insert({
        activity_id: activityOfA,
        kind: 'at',
        local_time: '07:00',
        weekdays: [1],
      });

      // The insert policy checks ownership of the parent, so this is refused rather than silently
      // creating a schedule B can see on an activity B does not own.
      expect(error).not.toBeNull();
    });

    it('ignores a forged user_id, taking the owner from the parent activity', async () => {
      const activityOfA = await activityFor(userA);
      const bId = (await userB.auth.getUser()).data.user!.id;

      const { data, error } = await userA
        .from('activity_schedules')
        .insert({
          activity_id: activityOfA,
          user_id: bId, // the forgery
          kind: 'at',
          local_time: '07:00',
          weekdays: [1],
        })
        .select('id, user_id')
        .single();

      expect(error).toBeNull();
      // The trigger overwrote it. Without that, this row would belong to B as far as every policy and the
      // scheduling function are concerned.
      expect((data as { user_id: string }).user_id).not.toBe(bId);

      const { data: visibleToB } = await userB
        .from('activity_schedules')
        .select('id')
        .eq('id', (data as { id: string }).id);
      expect(visibleToB).toHaveLength(0);
    });

    it('hides one user\u2019s schedules from another', async () => {
      const activity = await activityFor(userA);
      await userA
        .from('activity_schedules')
        .insert({ activity_id: activity, kind: 'at', local_time: '07:00', weekdays: [1] });

      const { data } = await userB.from('activity_schedules').select('id');
      expect(data).toHaveLength(0);
    });

    it('refuses to delete another user\u2019s schedule', async () => {
      const activity = await activityFor(userA);
      const { data: created } = await userA
        .from('activity_schedules')
        .insert({ activity_id: activity, kind: 'at', local_time: '07:00', weekdays: [1] })
        .select('id')
        .single();
      const id = (created as { id: string }).id;

      // No error: a delete matching no visible row is a no-op, which is how RLS reads. What matters is
      // that the row survives.
      await userB.from('activity_schedules').delete().eq('id', id);

      const { data: still } = await service.from('activity_schedules').select('id').eq('id', id);
      expect(still).toHaveLength(1);
    });
  });

  describe('activity_types is reference data', () => {
    it('is readable by any signed-in user', async () => {
      // Requirement 11.6. Like fasting_stages: it describes nobody, and the same rows ship in the bundle.
      const { data, error } = await userB.from('activity_types').select('key');
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });

    it('cannot be written by a client', async () => {
      const { error } = await userA.from('activity_types').insert({
        key: 'forged',
        label: 'Forged',
        icon: 'x',
        default_minutes: 5,
        unit: 'minutes',
        sort_order: 99,
      });
      expect(error).not.toBeNull();
    });
  });
});

/** A harmless change per table, used to prove an update by the wrong user does nothing. */
function mutationFor(table: UserTable): Record<string, unknown> {
  switch (table) {
    case 'fasts':
      return { note: 'tampered' };
    case 'weight_entries':
      return { grams: 99_000 };
    case 'water_entries':
      return { ml: 999 };
    case 'day_notes':
      return { note: 'tampered' };
    case 'push_subscriptions':
      return { p256dh: 'tampered' };
    case 'reminders':
      return { enabled: false };
    case 'notifications':
      return { status: 'sent' };
    case 'activities':
      return { duration_minutes: 999 };
    case 'activity_log':
      return { label: 'tampered' };
  }
}
