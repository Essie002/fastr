/**
 * Importing activities, and importing a file that predates them. Requirement 12.6.
 *
 * The second half is the one that matters. Every export already downloaded has no `activities` key at all, and
 * an import that rejected those files would make the feature a breaking change for exactly the users who were
 * careful enough to keep a backup. So the compatibility case is tested first and explicitly.
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

/** An export with no activity keys, as produced before this feature existed. */
const legacyExport = {
  version: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  profile: { displayName: 'Ada' },
  fasts: [],
  weightEntries: [],
  waterEntries: [{ loggedAt: '2026-01-01T08:00:00.000Z', ml: 250 }],
  dayNotes: [],
  reminders: [{ localTime: '20:00', weekdays: [1, 2, 3], enabled: true }],
};

describe.skipIf(!hasStack())('importing activities', () => {
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

  async function runImport(payload: unknown) {
    return service.rpc('import_fastr_export', { target_user: userId, payload });
  }

  it('accepts an export made before activities existed (Req 12.6)', async () => {
    const { data, error } = await runImport(legacyExport);

    expect(error).toBeNull();
    const counts = data as Record<string, number>;
    expect(counts.reminders).toBe(1);
    expect(counts.waterEntries).toBe(1);
    // Reported as zero rather than absent, so a caller can show "0 activities" instead of "undefined".
    expect(counts.activities).toBe(0);
    expect(counts.activityLog).toBe(0);
  });

  it('restores activities with their nested schedules', async () => {
    const { data, error } = await runImport({
      ...legacyExport,
      activities: [
        {
          typeKey: 'swim',
          customLabel: null,
          durationMinutes: 45,
          notifyEnd: true,
          enabled: true,
          schedules: [
            { kind: 'at', localTime: '07:00', weekdays: [2], enabled: true },
            { kind: 'at', localTime: '09:00', weekdays: [6], enabled: true },
          ],
        },
        {
          typeKey: null,
          customLabel: 'Physio',
          durationMinutes: 20,
          notifyEnd: false,
          enabled: false,
          schedules: [
            {
              kind: 'every',
              windowStart: '08:00',
              windowEnd: '20:00',
              intervalMinutes: 180,
              weekdays: [1, 3, 5],
              enabled: true,
            },
          ],
        },
      ],
      activityLog: [
        {
          label: 'Swim',
          typeKey: 'swim',
          occurredAt: '2026-01-02T07:00:00.000Z',
          minutes: 45,
          note: null,
        },
      ],
    });

    expect(error).toBeNull();
    const counts = data as Record<string, number>;
    expect(counts.activities).toBe(2);
    expect(counts.activityLog).toBe(1);

    const { data: activities } = await service
      .from('activities')
      .select(
        'type_key, custom_label, duration_minutes, notify_end, enabled, activity_schedules (kind, local_time, interval_minutes, weekdays)',
      )
      .eq('user_id', userId)
      .order('created_at');

    const rows = (activities ?? []) as Record<string, unknown>[];
    expect(rows).toHaveLength(2);

    const swim = rows.find((row) => row.type_key === 'swim')!;
    expect(swim.notify_end).toBe(true);
    // Two schedules on one activity, which is the whole reason schedules are their own table.
    expect((swim.activity_schedules as unknown[]).length).toBe(2);

    const physio = rows.find((row) => row.custom_label === 'Physio')!;
    expect(physio.type_key).toBeNull();
    expect(physio.enabled).toBe(false);
    const physioSchedule = (physio.activity_schedules as Record<string, unknown>[])[0]!;
    expect(physioSchedule.kind).toBe('every');
    expect(physioSchedule.interval_minutes).toBe(180);
  });

  it('sets the schedule owner from the parent, not from the file', async () => {
    // The file carries no ids and no user_id. The before-insert trigger is what attributes the schedule, and
    // if it did not run the row would be orphaned from its owner and invisible to them.
    await runImport({
      ...legacyExport,
      activities: [
        {
          typeKey: 'walk',
          customLabel: null,
          durationMinutes: 20,
          notifyEnd: false,
          enabled: true,
          schedules: [{ kind: 'at', localTime: '07:00', weekdays: [1], enabled: true }],
        },
      ],
    });

    const { data } = await service
      .from('activity_schedules')
      .select('user_id')
      .eq('user_id', userId);
    expect(data).toHaveLength(1);
  });

  it('leaves imported completions unattached to an activity', async () => {
    // Deliberate: `activity_id` is nullable because history outlives the activity, and guessing which
    // imported activity an old completion belonged to would invent a link the file does not contain.
    await runImport({
      ...legacyExport,
      activities: [
        {
          typeKey: 'swim',
          customLabel: null,
          durationMinutes: 45,
          notifyEnd: false,
          enabled: true,
          schedules: [],
        },
      ],
      activityLog: [
        {
          label: 'Swim',
          typeKey: 'swim',
          occurredAt: '2026-01-02T07:00:00.000Z',
          minutes: 45,
          note: null,
        },
      ],
    });

    const { data } = await service
      .from('activity_log')
      .select('activity_id, label')
      .eq('user_id', userId);

    expect(data).toHaveLength(1);
    expect((data as Record<string, unknown>[])[0]!.activity_id).toBeNull();
  });

  it('refuses the whole file if it would exceed the activity limit', async () => {
    // All or nothing. Silently dropping the twenty-first activity would be a worse answer than refusing,
    // because the user would have no way to know what was lost.
    const many = Array.from({ length: 21 }, () => ({
      typeKey: 'walk',
      customLabel: null,
      durationMinutes: 20,
      notifyEnd: false,
      enabled: true,
      schedules: [],
    }));

    const { error } = await runImport({ ...legacyExport, activities: many });
    expect(error).not.toBeNull();

    // And nothing landed, including the reminders that come earlier in the same transaction.
    const { data: activities } = await service
      .from('activities')
      .select('id')
      .eq('user_id', userId);
    const { data: reminders } = await service.from('reminders').select('id').eq('user_id', userId);
    expect(activities).toHaveLength(0);
    expect(reminders).toHaveLength(0);
  });

  it('counts activities and schedules in the deletion-proof view', async () => {
    await runImport({
      ...legacyExport,
      activities: [
        {
          typeKey: 'swim',
          customLabel: null,
          durationMinutes: 45,
          notifyEnd: false,
          enabled: true,
          schedules: [{ kind: 'at', localTime: '07:00', weekdays: [1], enabled: true }],
        },
      ],
    });

    const { data } = await service
      .from('fastr_user_row_counts')
      .select('activities, activity_schedules, activity_log')
      .eq('user_id', userId)
      .single();

    const counts = data as Record<string, number>;
    // The view exists so account deletion can be proved without the table list living in two places. A new
    // table missing from it is a cascade nobody checked.
    expect(counts.activities).toBe(1);
    expect(counts.activity_schedules).toBe(1);
  });
});
