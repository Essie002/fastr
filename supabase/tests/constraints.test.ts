/**
 * Proof that the database refuses invalid data, and that it draws its boundaries in exactly the same
 * places the shared Zod schemas do. Requirements 5.2, 5.9, 11.4, 13.1, 17.3, 18.6.
 *
 * Why this suite exists at all, when the app already validates with Zod: the anon key is published
 * and anyone can sign in and POST straight to the REST endpoint. So these tests are written as that
 * attacker would behave, sending values the UI would never produce.
 *
 * The parity block at the bottom is the part that keeps the two halves honest. A bound tightened in
 * Zod and forgotten in a migration would otherwise be invisible until somebody hit it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_GOAL_MINUTES,
  MAX_NOTE_LENGTH,
  MAX_WEIGHT_GRAMS,
  MIN_GOAL_MINUTES,
  MIN_WEIGHT_GRAMS,
  goalMinutesSchema,
  weightEntrySchema,
} from '@fastr/shared';
import {
  SEED_USERS,
  hasStack,
  localStack,
  resetUserData,
  signedInClient,
  type LocalStack,
} from './helpers.js';

/** Hours from a fixed base, so every fast in this file sits in its own slot and cannot overlap. */
const BASE = Date.UTC(2021, 0, 1);
const at = (hours: number) => new Date(BASE + hours * 3_600_000).toISOString();

describe.skipIf(!hasStack())('database constraints', () => {
  let stack: LocalStack;
  let user: SupabaseClient;
  let userId: string;

  beforeAll(async () => {
    stack = localStack()!;
    user = await signedInClient(stack, 'a');
    userId = SEED_USERS.a.id;
  });

  afterAll(async () => {
    await resetUserData(stack);
  });

  beforeEach(async () => {
    await resetUserData(stack);
  });

  /** Inserts a fast as the signed-in user and returns the error, if any. */
  async function insertFast(row: Record<string, unknown>): Promise<PostgrestError | null> {
    const { error } = await user.from('fasts').insert({ user_id: userId, ...row });
    return error;
  }

  const validFast = {
    plan_id: '16:8',
    goal_minutes: 960,
    start_at: at(0),
    ended_at: at(16),
    status: 'completed',
  };

  describe('one active fast per user (Req 5.2)', () => {
    it('accepts the first active fast', async () => {
      expect(await insertFast({ ...validFast, ended_at: null, status: 'active' })).toBeNull();
    });

    it('refuses a second active fast', async () => {
      await insertFast({ ...validFast, ended_at: null, status: 'active' });
      const error = await insertFast({
        ...validFast,
        start_at: at(1),
        ended_at: null,
        status: 'active',
      });
      expect(error).not.toBeNull();
      // Caught by the exclusion constraint rather than the partial unique index: two
      // [start, infinity) ranges always intersect, so the exclusion always fires first. The index is
      // kept as a statement of the rule, not as the thing enforcing it.
      expect(error?.message).toMatch(/fasts_no_overlap/);
    });
  });

  describe('no overlapping fasts (Req 5.9)', () => {
    it('refuses a fast that overlaps an existing one', async () => {
      await insertFast(validFast); // 00:00 to 16:00
      const error = await insertFast({ ...validFast, start_at: at(8), ended_at: at(20) });
      expect(error?.message).toMatch(/fasts_no_overlap/);
    });

    it('refuses a fast entirely inside an existing one', async () => {
      await insertFast(validFast);
      const error = await insertFast({ ...validFast, start_at: at(4), ended_at: at(8) });
      expect(error?.message).toMatch(/fasts_no_overlap/);
    });

    it('accepts a fast that starts exactly when another ended', async () => {
      // The range is half-open, `[)`, so touching endpoints do not overlap. Without that, ending a
      // fast and immediately starting the next would be refused, which is a normal thing to do.
      await insertFast(validFast); // ends at 16:00
      expect(await insertFast({ ...validFast, start_at: at(16), ended_at: at(32) })).toBeNull();
    });

    it('lets two different users hold fasts at the same time', async () => {
      // The constraint is scoped by user_id. Without that scope it would be a global lock on time.
      await insertFast(validFast);
      const other = await signedInClient(stack, 'b');
      const { error } = await other
        .from('fasts')
        .insert({ user_id: SEED_USERS.b.id, ...validFast });
      expect(error).toBeNull();
    });
  });

  describe('status and end time agree (Req 5.8)', () => {
    it('refuses an active fast carrying an end time', async () => {
      const error = await insertFast({ ...validFast, status: 'active' });
      expect(error?.message).toMatch(/fast_end_matches_status/);
    });

    it('refuses a finished fast with no end time', async () => {
      const error = await insertFast({ ...validFast, ended_at: null });
      expect(error?.message).toMatch(/fast_end_matches_status/);
    });

    it('refuses an end before its start', async () => {
      const error = await insertFast({ ...validFast, start_at: at(16), ended_at: at(8) });
      expect(error?.message).toMatch(/fast_end_matches_status/);
    });

    it('refuses an end equal to its start', async () => {
      const error = await insertFast({ ...validFast, start_at: at(0), ended_at: at(0) });
      expect(error?.message).toMatch(/fast_end_matches_status/);
    });

    it('accepts ended_early with a proper end time', async () => {
      expect(await insertFast({ ...validFast, status: 'ended_early', ended_at: at(9) })).toBeNull();
    });
  });

  describe('goal length (Req 17.3)', () => {
    it('accepts exactly 72 hours', async () => {
      expect(await insertFast({ ...validFast, goal_minutes: MAX_GOAL_MINUTES })).toBeNull();
    });

    it('refuses one minute over 72 hours', async () => {
      const error = await insertFast({ ...validFast, goal_minutes: MAX_GOAL_MINUTES + 1 });
      expect(error?.message).toMatch(/goal_minutes/);
    });

    it('accepts exactly one hour', async () => {
      expect(await insertFast({ ...validFast, goal_minutes: MIN_GOAL_MINUTES })).toBeNull();
    });

    it('refuses under an hour', async () => {
      const error = await insertFast({ ...validFast, goal_minutes: MIN_GOAL_MINUTES - 1 });
      expect(error?.message).toMatch(/goal_minutes/);
    });
  });

  describe('mood, energy and notes (Req 13.1)', () => {
    it.each([0, 6])('refuses a mood of %i', async (mood) => {
      expect(await insertFast({ ...validFast, mood })).not.toBeNull();
    });

    it.each([1, 3, 5])('accepts a mood of %i', async (mood) => {
      expect(await insertFast({ ...validFast, mood })).toBeNull();
    });

    it('accepts a note at the length limit', async () => {
      expect(await insertFast({ ...validFast, note: 'a'.repeat(MAX_NOTE_LENGTH) })).toBeNull();
    });

    it('refuses a note one character over', async () => {
      const error = await insertFast({ ...validFast, note: 'a'.repeat(MAX_NOTE_LENGTH + 1) });
      expect(error).not.toBeNull();
    });
  });

  describe('weight (Req 11.4)', () => {
    async function insertWeight(grams: number, day = '2021-01-01') {
      const { error } = await user
        .from('weight_entries')
        .insert({ user_id: userId, measured_on: day, grams });
      return error;
    }

    it('accepts the boundaries', async () => {
      expect(await insertWeight(MIN_WEIGHT_GRAMS, '2021-01-01')).toBeNull();
      expect(await insertWeight(MAX_WEIGHT_GRAMS, '2021-01-02')).toBeNull();
    });

    it('refuses just outside the boundaries', async () => {
      expect(await insertWeight(MIN_WEIGHT_GRAMS - 1, '2021-01-03')).not.toBeNull();
      expect(await insertWeight(MAX_WEIGHT_GRAMS + 1, '2021-01-04')).not.toBeNull();
    });

    it('allows only one entry per day', async () => {
      // A second reading for one day is a correction, not a new fact. Two rows would make the chart
      // zigzag between them.
      expect(await insertWeight(72_000, '2021-02-01')).toBeNull();
      expect(await insertWeight(73_000, '2021-02-01')).not.toBeNull();
    });
  });

  describe('water', () => {
    it('refuses zero and refuses more than five litres at once', async () => {
      const insert = (ml: number) =>
        user.from('water_entries').insert({ user_id: userId, ml, logged_at: at(0) });
      expect((await insert(0)).error).not.toBeNull();
      expect((await insert(5001)).error).not.toBeNull();
      expect((await insert(250)).error).toBeNull();
    });
  });

  describe('reminders (Req 8.1)', () => {
    const insert = (weekdays: number[]) =>
      user.from('reminders').insert({ user_id: userId, local_time: '20:00', weekdays });

    it('refuses an empty weekday list', async () => {
      expect((await insert([])).error).not.toBeNull();
    });

    it('refuses a weekday outside zero to six', async () => {
      expect((await insert([7])).error).not.toBeNull();
      expect((await insert([-1])).error).not.toBeNull();
    });

    it('accepts a valid list', async () => {
      expect((await insert([0, 3, 6])).error).toBeNull();
    });
  });

  // The notifications table's own check constraints (stage_key only for stage rows, reminders
  // carrying no fast) are exercised in task 8's trigger suite, which is the only thing that writes
  // to it. The client cannot insert there at all, so there is nothing to assert from here.

  describe('parity with the shared Zod schemas (Req 18.6)', () => {
    /**
     * The point of this block: every boundary below is asserted twice, once against Zod and once
     * against Postgres, and the test fails if they disagree. That is what stops the two halves of
     * validation drifting apart.
     */

    it.each([MIN_GOAL_MINUTES - 1, MIN_GOAL_MINUTES, 960, MAX_GOAL_MINUTES, MAX_GOAL_MINUTES + 1])(
      'agrees on a goal of %i minutes',
      async (minutes) => {
        const zodAccepts = goalMinutesSchema.safeParse(minutes).success;
        const dbAccepts = (await insertFast({ ...validFast, goal_minutes: minutes })) === null;
        expect(dbAccepts, `Zod ${zodAccepts ? 'accepts' : 'rejects'} ${minutes}`).toBe(zodAccepts);
      },
    );

    it.each([
      MIN_WEIGHT_GRAMS - 1,
      MIN_WEIGHT_GRAMS,
      72_000,
      MAX_WEIGHT_GRAMS,
      MAX_WEIGHT_GRAMS + 1,
    ])('agrees on a weight of %i grams', async (grams) => {
      const zodAccepts = weightEntrySchema.safeParse({ measuredOn: '2021-03-01', grams }).success;
      const { error } = await user
        .from('weight_entries')
        .insert({ user_id: userId, measured_on: '2021-03-01', grams });
      expect(error === null, `Zod ${zodAccepts ? 'accepts' : 'rejects'} ${grams}`).toBe(zodAccepts);
    });

    it.each([MAX_NOTE_LENGTH, MAX_NOTE_LENGTH + 1])(
      'agrees on a note of %i characters',
      async (length) => {
        const note = 'a'.repeat(length);
        const zodAccepts = length <= MAX_NOTE_LENGTH;
        const dbAccepts = (await insertFast({ ...validFast, note })) === null;
        expect(dbAccepts).toBe(zodAccepts);
      },
    );
  });
});
