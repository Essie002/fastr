import type { LocalDate, WeightEntry } from '@fastr/shared';
import { getSupabase } from './supabase.js';

/**
 * The weight log. Requirement 11.
 *
 * Stored in grams and converted only for display, so switching between kg and lb re-renders the same history
 * rather than reinterpreting it.
 */

interface WeightRow {
  id: string;
  user_id: string;
  measured_on: string;
  grams: number;
}

const COLUMNS = 'id, user_id, measured_on, grams';

export const weightQueryKey = ['weight'] as const;

function toEntry(row: WeightRow): WeightEntry {
  return {
    id: row.id,
    userId: row.user_id,
    measuredOn: row.measured_on,
    grams: row.grams,
  };
}

/** Oldest first, which is the order a chart needs and saves re-sorting on every render. */
export async function fetchWeightEntries(since?: LocalDate): Promise<WeightEntry[]> {
  let query = getSupabase()
    .from('weight_entries')
    .select(COLUMNS)
    .order('measured_on', { ascending: true });

  if (since) query = query.gte('measured_on', since);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => toEntry(row as WeightRow));
}

/**
 * Records a weight for a day, replacing anything already there.
 *
 * An upsert rather than an insert, because the table has one row per user per day. A second reading on one
 * day is a correction, not a new fact, and two rows would make the chart zigzag between them.
 */
export async function saveWeight(input: {
  measuredOn: LocalDate;
  grams: number;
}): Promise<WeightEntry> {
  const { data: user } = await getSupabase().auth.getUser();
  if (!user.user) throw new Error('Not signed in.');

  const { data, error } = await getSupabase()
    .from('weight_entries')
    .upsert(
      { user_id: user.user.id, measured_on: input.measuredOn, grams: input.grams },
      { onConflict: 'user_id,measured_on' },
    )
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return toEntry(data as WeightRow);
}

export async function deleteWeight(id: string): Promise<void> {
  const { error } = await getSupabase().from('weight_entries').delete().eq('id', id);
  if (error) throw error;
}

/** Turns a weight error into a sentence. The range check is the only one a user can trip. */
export function describeWeightError(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

  if (/grams/.test(message)) {
    return 'That weight is outside the range Fastr accepts, which is 20 to 400 kg.';
  }
  return 'That did not save. Check your connection and try again.';
}
