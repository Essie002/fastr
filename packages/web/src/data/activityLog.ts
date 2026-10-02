import type { Instant } from '@fastr/shared';
import { activityLabel, isVolumeActivity } from '@fastr/shared';
import { getSupabase } from './supabase.js';
import { addWater } from './water.js';

/**
 * Recorded completions. Requirement 5.
 *
 * Two things here are deliberate and easy to get wrong.
 *
 * **Water does not come here.** Requirement 5.6: a water completion writes a `water_entries` row through the
 * existing water feature, because water already has a goal, a daily total and a UI built on that table. Two
 * records of how much somebody drank is a bug waiting to be discovered, and the one that would be discovered
 * is the user's goal not moving when they log a glass from a notification.
 *
 * **The label is snapshotted, not joined.** `activity_id` is `on delete set null`, so a history row must be
 * able to render with no parent — and joining for the label would mean renaming an activity retitles history
 * retroactively. A log is a record of what was true then.
 */

export interface ActivityCompletion {
  id: string;
  activityId: string | null;
  label: string;
  typeKey: string | null;
  occurredAt: Instant;
  minutes: number | null;
  source: 'manual' | 'strava';
  note: string | null;
}

interface LogRow {
  id: string;
  activity_id: string | null;
  label: string;
  type_key: string | null;
  occurred_at: string;
  minutes: number | null;
  source: 'manual' | 'strava';
  note: string | null;
}

const COLUMNS = 'id, activity_id, label, type_key, occurred_at, minutes, source, note';

export const activityLogQueryKey = ['activityLog'] as const;

function toCompletion(row: LogRow): ActivityCompletion {
  return {
    id: row.id,
    activityId: row.activity_id,
    label: row.label,
    typeKey: row.type_key,
    occurredAt: row.occurred_at,
    minutes: row.minutes,
    source: row.source,
    note: row.note,
  };
}

/**
 * Completions over a window, newest first.
 *
 * A window in days rather than a row limit, because the stats and the day grouping both ask "what happened in
 * the last 30 days" and a limit would silently truncate a busy month.
 */
export async function fetchActivityLog(days = 90): Promise<ActivityCompletion[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await getSupabase()
    .from('activity_log')
    .select(COLUMNS)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => toCompletion(row as LogRow));
}

export interface RecordInput {
  activityId: string | null;
  typeKey: string | null;
  customLabel: string | null;
  minutes: number | null;
  occurredAt?: Instant;
  note?: string | null;
  /**
   * For a volume activity. Millilitres, which go to the water feature rather than to this table.
   *
   * Explicitly `| undefined` because `exactOptionalPropertyTypes` is on, and the caller passes
   * `ml: undefined` for a timed activity rather than omitting the key.
   */
  ml?: number | undefined;
}

/**
 * Records that an activity happened.
 *
 * Returns null for a volume activity, because nothing was written to `activity_log` — the caller should
 * invalidate the water query rather than this one. Returning the water entry instead would make the return
 * type a union that every caller has to narrow for no benefit.
 */
export async function recordCompletion(input: RecordInput): Promise<ActivityCompletion | null> {
  const { data: user } = await getSupabase().auth.getUser();
  if (!user.user) throw new Error('Not signed in.');

  if (isVolumeActivity(input.typeKey)) {
    // Requirement 5.6. Straight through to the existing water feature, so the daily total and the goal
    // both move.
    await addWater(input.ml ?? 250, input.occurredAt);
    return null;
  }

  const { data, error } = await getSupabase()
    .from('activity_log')
    .insert({
      user_id: user.user.id,
      activity_id: input.activityId,
      label: activityLabel(input.typeKey, input.customLabel),
      type_key: input.typeKey,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      minutes: input.minutes,
      // Explicit rather than relying on the column default, so the one value that matters for a future
      // integration is visible at the call site.
      source: 'manual',
      note: input.note ?? null,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return toCompletion(data as LogRow);
}

export async function deleteCompletion(id: string): Promise<void> {
  const { error } = await getSupabase().from('activity_log').delete().eq('id', id);
  if (error) throw error;
}
