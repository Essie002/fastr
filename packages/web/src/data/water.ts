import type { Instant, TimeZone, WaterEntry } from '@fastr/shared';
import { localDayOf } from '@fastr/shared';
import { getSupabase } from './supabase.js';

/**
 * Water intake. Requirement 12.
 *
 * Stored as an instant rather than a date, because "today" means the user's local calendar day and that can
 * only be worked out at read time against their current time zone. A stored date would be wrong for anyone
 * who travels, and wrong for everyone near midnight.
 */

interface WaterRow {
  id: string;
  user_id: string;
  logged_at: string;
  ml: number;
}

const COLUMNS = 'id, user_id, logged_at, ml';

export const waterQueryKey = ['water'] as const;

function toEntry(row: WaterRow): WaterEntry {
  return { id: row.id, userId: row.user_id, loggedAt: row.logged_at, ml: row.ml };
}

/**
 * Recent entries, newest first.
 *
 * Fetches a window wide enough to cover any time zone's idea of today and yesterday rather than filtering by
 * date in the query: the day boundary depends on the user's zone, so the filter belongs in code that knows it.
 */
export async function fetchRecentWater(): Promise<WaterEntry[]> {
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await getSupabase()
    .from('water_entries')
    .select(COLUMNS)
    .gte('logged_at', since)
    .order('logged_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => toEntry(row as WaterRow));
}

export async function addWater(ml: number, loggedAt?: Instant): Promise<WaterEntry> {
  const { data: user } = await getSupabase().auth.getUser();
  if (!user.user) throw new Error('Not signed in.');

  const { data, error } = await getSupabase()
    .from('water_entries')
    .insert({
      user_id: user.user.id,
      ml,
      logged_at: loggedAt ?? new Date().toISOString(),
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return toEntry(data as WaterRow);
}

export async function deleteWater(id: string): Promise<void> {
  const { error } = await getSupabase().from('water_entries').delete().eq('id', id);
  if (error) throw error;
}

/** Requirement 12.4. Entries belonging to the user's local today. */
export function todaysEntries(
  entries: readonly WaterEntry[],
  timeZone: TimeZone,
  today: Date,
): WaterEntry[] {
  const day = localDayOf(today, timeZone);
  return entries.filter((entry) => localDayOf(entry.loggedAt, timeZone) === day);
}

export function totalMl(entries: readonly WaterEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.ml, 0);
}
