/**
 * Zod and Postgres agree about activities. Requirement 12.5.
 *
 * Every rule worth having exists twice: once in Zod, for a message the user can act on before a request
 * leaves the browser, and once as a constraint, because the anon key is published and anyone can sign in and
 * POST straight at the REST endpoint. Two copies of a rule is two things that can drift, and the drift is
 * asymmetric and nasty — loosen the constraint and the app is wrong, loosen Zod and the app shows a confusing
 * database error instead of a sentence.
 *
 * So each case below asserts the same value is accepted or rejected by both. The pairs, not the individual
 * assertions, are the point.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  activityLogSchema,
  activityScheduleSchema,
  activitySchema,
} from '../../packages/shared/src/schemas.js';
import {
  SEED_USERS,
  hasStack,
  localStack,
  resetUserData,
  serviceClient,
  type LocalStack,
} from './helpers.js';

const zodAccepts = (
  schema: { safeParse: (value: unknown) => { success: boolean } },
  value: unknown,
) => schema.safeParse(value).success;

describe.skipIf(!hasStack())('activity validation parity', () => {
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

  /** Does Postgres take this activity? */
  async function pgAcceptsActivity(row: Record<string, unknown>): Promise<boolean> {
    const { error } = await service.from('activities').insert({ user_id: userId, ...row });
    return error === null;
  }

  async function makeActivity(): Promise<string> {
    const { data, error } = await service
      .from('activities')
      .insert({ user_id: userId, type_key: 'swim', duration_minutes: 45 })
      .select('id')
      .single();
    expect(error).toBeNull();
    return (data as { id: string }).id;
  }

  async function pgAcceptsSchedule(row: Record<string, unknown>): Promise<boolean> {
    const activity = await makeActivity();
    const { error } = await service
      .from('activity_schedules')
      .insert({ activity_id: activity, user_id: userId, ...row });
    return error === null;
  }

  async function pgAcceptsLog(row: Record<string, unknown>): Promise<boolean> {
    const { error } = await service.from('activity_log').insert({ user_id: userId, ...row });
    return error === null;
  }

  describe('an activity is named exactly once', () => {
    it('accepts a preset with no custom label', async () => {
      const zod = {
        typeKey: 'swim',
        customLabel: null,
        durationMinutes: 45,
        notifyEnd: false,
        enabled: true,
      };
      expect(zodAccepts(activitySchema, zod)).toBe(true);
      expect(await pgAcceptsActivity({ type_key: 'swim', duration_minutes: 45 })).toBe(true);
    });

    it('accepts a custom label with no preset', async () => {
      const zod = {
        typeKey: null,
        customLabel: 'Physio',
        durationMinutes: 20,
        notifyEnd: false,
        enabled: true,
      };
      expect(zodAccepts(activitySchema, zod)).toBe(true);
      expect(await pgAcceptsActivity({ custom_label: 'Physio', duration_minutes: 20 })).toBe(true);
    });

    it('rejects both at once', async () => {
      const zod = {
        typeKey: 'swim',
        customLabel: 'Physio',
        durationMinutes: 45,
        notifyEnd: false,
        enabled: true,
      };
      expect(zodAccepts(activitySchema, zod)).toBe(false);
      expect(
        await pgAcceptsActivity({ type_key: 'swim', custom_label: 'Physio', duration_minutes: 45 }),
      ).toBe(false);
    });

    it('rejects neither', async () => {
      const zod = {
        typeKey: null,
        customLabel: null,
        durationMinutes: 45,
        notifyEnd: false,
        enabled: true,
      };
      expect(zodAccepts(activitySchema, zod)).toBe(false);
      expect(await pgAcceptsActivity({ duration_minutes: 45 })).toBe(false);
    });

    it('rejects a blank custom label, trimmed', async () => {
      // Three spaces passes a naive length check and then renders as nothing at all in a notification.
      const zod = {
        typeKey: null,
        customLabel: '   ',
        durationMinutes: 45,
        notifyEnd: false,
        enabled: true,
      };
      expect(zodAccepts(activitySchema, zod)).toBe(false);
      expect(await pgAcceptsActivity({ custom_label: '   ', duration_minutes: 45 })).toBe(false);
    });

    it('rejects an unknown preset key', async () => {
      const zod = {
        typeKey: 'teleport',
        customLabel: null,
        durationMinutes: 45,
        notifyEnd: false,
        enabled: true,
      };
      expect(zodAccepts(activitySchema, zod)).toBe(false);
      // Postgres refuses it as a foreign key violation, which is the point of the generated table.
      expect(await pgAcceptsActivity({ type_key: 'teleport', duration_minutes: 45 })).toBe(false);
    });
  });

  describe('duration bounds', () => {
    it.each([
      [1, true],
      [480, true],
      [0, false],
      [481, false],
    ])('duration %s is accepted by both: %s', async (minutes, expected) => {
      const zod = {
        typeKey: 'swim',
        customLabel: null,
        durationMinutes: minutes,
        notifyEnd: false,
        enabled: true,
      };
      expect(zodAccepts(activitySchema, zod)).toBe(expected);
      expect(await pgAcceptsActivity({ type_key: 'swim', duration_minutes: minutes })).toBe(
        expected,
      );
    });
  });

  describe('schedule shapes', () => {
    it('accepts a wall-clock schedule', async () => {
      expect(
        zodAccepts(activityScheduleSchema, {
          kind: 'at',
          localTime: '07:00',
          weekdays: [1, 3],
          enabled: true,
        }),
      ).toBe(true);
      expect(await pgAcceptsSchedule({ kind: 'at', local_time: '07:00', weekdays: [1, 3] })).toBe(
        true,
      );
    });

    it('rejects a wall-clock schedule carrying interval fields', async () => {
      // Unrepresentable in the discriminated union, so Zod refuses it on shape alone.
      expect(
        zodAccepts(activityScheduleSchema, {
          kind: 'at',
          localTime: '07:00',
          intervalMinutes: 60,
          weekdays: [1],
          enabled: true,
        }),
      ).toBe(false);
      expect(
        await pgAcceptsSchedule({
          kind: 'at',
          local_time: '07:00',
          interval_minutes: 60,
          weekdays: [1],
        }),
      ).toBe(false);
    });

    it('accepts an interval schedule', async () => {
      expect(
        zodAccepts(activityScheduleSchema, {
          kind: 'every',
          windowStart: '08:00',
          windowEnd: '20:00',
          intervalMinutes: 120,
          weekdays: [1],
          enabled: true,
        }),
      ).toBe(true);
      expect(
        await pgAcceptsSchedule({
          kind: 'every',
          window_start: '08:00',
          window_end: '20:00',
          interval_minutes: 120,
          weekdays: [1],
        }),
      ).toBe(true);
    });

    it('rejects a window shorter than its interval (Req 3.2)', async () => {
      // An hour-long window on a two-hour interval can fire once, which is not what "every two hours"
      // means. Both sides refuse rather than silently degrading it to a single daily reminder.
      expect(
        zodAccepts(activityScheduleSchema, {
          kind: 'every',
          windowStart: '08:00',
          windowEnd: '09:00',
          intervalMinutes: 120,
          weekdays: [1],
          enabled: true,
        }),
      ).toBe(false);
      expect(
        await pgAcceptsSchedule({
          kind: 'every',
          window_start: '08:00',
          window_end: '09:00',
          interval_minutes: 120,
          weekdays: [1],
        }),
      ).toBe(false);
    });

    it('rejects a window that ends before it starts', async () => {
      expect(
        zodAccepts(activityScheduleSchema, {
          kind: 'every',
          windowStart: '20:00',
          windowEnd: '08:00',
          intervalMinutes: 60,
          weekdays: [1],
          enabled: true,
        }),
      ).toBe(false);
      expect(
        await pgAcceptsSchedule({
          kind: 'every',
          window_start: '20:00',
          window_end: '08:00',
          interval_minutes: 60,
          weekdays: [1],
        }),
      ).toBe(false);
    });

    it.each([
      [15, true],
      [720, true],
      [14, false],
      [721, false],
    ])('interval %s is accepted by both: %s', async (interval, expected) => {
      expect(
        zodAccepts(activityScheduleSchema, {
          kind: 'every',
          windowStart: '00:00',
          windowEnd: '23:59',
          intervalMinutes: interval,
          weekdays: [1],
          enabled: true,
        }),
      ).toBe(expected);
      expect(
        await pgAcceptsSchedule({
          kind: 'every',
          window_start: '00:00',
          window_end: '23:59',
          interval_minutes: interval,
          weekdays: [1],
        }),
      ).toBe(expected);
    });

    it('rejects an empty weekday list and an out-of-range day', async () => {
      for (const weekdays of [[], [7], [-1]]) {
        expect(
          zodAccepts(activityScheduleSchema, {
            kind: 'at',
            localTime: '07:00',
            weekdays,
            enabled: true,
          }),
          JSON.stringify(weekdays),
        ).toBe(false);
        expect(
          await pgAcceptsSchedule({ kind: 'at', local_time: '07:00', weekdays }),
          JSON.stringify(weekdays),
        ).toBe(false);
      }
    });
  });

  describe('completions', () => {
    it('accepts a logged activity with and without a duration', async () => {
      const base = {
        label: 'Walk',
        typeKey: 'walk',
        occurredAt: '2026-01-01T08:00:00.000Z',
        note: null,
      };
      expect(zodAccepts(activityLogSchema, { ...base, minutes: 20 })).toBe(true);
      expect(zodAccepts(activityLogSchema, { ...base, minutes: null })).toBe(true);

      expect(
        await pgAcceptsLog({
          label: 'Walk',
          type_key: 'walk',
          occurred_at: '2026-01-01T08:00:00.000Z',
          minutes: 20,
        }),
      ).toBe(true);
      expect(
        await pgAcceptsLog({
          label: 'Walk',
          type_key: 'walk',
          occurred_at: '2026-01-02T08:00:00.000Z',
          minutes: null,
        }),
      ).toBe(true);
    });

    it.each([
      [1, true],
      [1440, true],
      [0, false],
      [1441, false],
    ])('logged duration %s is accepted by both: %s', async (minutes, expected) => {
      expect(
        zodAccepts(activityLogSchema, {
          label: 'Walk',
          typeKey: 'walk',
          occurredAt: '2026-01-01T08:00:00.000Z',
          minutes,
          note: null,
        }),
      ).toBe(expected);
      expect(
        await pgAcceptsLog({
          label: 'Walk',
          type_key: 'walk',
          occurred_at: '2026-01-01T08:00:00.000Z',
          minutes,
        }),
      ).toBe(expected);
    });

    it('rejects a note longer than 280 characters', async () => {
      const note = 'x'.repeat(281);
      expect(
        zodAccepts(activityLogSchema, {
          label: 'Walk',
          typeKey: 'walk',
          occurredAt: '2026-01-01T08:00:00.000Z',
          minutes: 20,
          note,
        }),
      ).toBe(false);
      expect(
        await pgAcceptsLog({
          label: 'Walk',
          type_key: 'walk',
          occurred_at: '2026-01-01T08:00:00.000Z',
          minutes: 20,
          note,
        }),
      ).toBe(false);
    });
  });

  describe('the activity limit (Req 1.7)', () => {
    it('refuses the twenty-first activity with a message the UI can show', async () => {
      // A trigger rather than a CHECK, because a CHECK cannot count other rows. Enforced in the database
      // because a limit that lives only in the client is not a limit — the table is reachable directly.
      for (let index = 0; index < 20; index += 1) {
        expect(
          await pgAcceptsActivity({ type_key: 'walk', duration_minutes: 20 }),
          `#${index}`,
        ).toBe(true);
      }

      const { error } = await service
        .from('activities')
        .insert({ user_id: userId, type_key: 'walk', duration_minutes: 20 });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/at most 20 activities/i);
    });
  });
});
