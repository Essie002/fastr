import type { Reminder } from '@fastr/shared';
import { getSupabase } from './supabase.js';

/**
 * Reminders. Requirement 8.
 *
 * A local wall-clock time plus the days it applies to, resolved against the profile's zone when the hourly job
 * queues it. Storing an instant instead would drift by an hour twice a year.
 */

interface ReminderRow {
  id: string;
  user_id: string;
  local_time: string;
  weekdays: number[];
  enabled: boolean;
}

const COLUMNS = 'id, user_id, local_time, weekdays, enabled';

export const remindersQueryKey = ['reminders'] as const;

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    userId: row.user_id,
    // Postgres returns `time` as `HH:MM:SS`; the input control wants `HH:MM`.
    localTime: row.local_time.slice(0, 5),
    weekdays: row.weekdays,
    enabled: row.enabled,
  };
}

export async function fetchReminders(): Promise<Reminder[]> {
  const { data, error } = await getSupabase()
    .from('reminders')
    .select(COLUMNS)
    .order('local_time', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => toReminder(row as ReminderRow));
}

export async function createReminder(input: {
  localTime: string;
  weekdays: number[];
}): Promise<Reminder> {
  const { data: user } = await getSupabase().auth.getUser();
  if (!user.user) throw new Error('Not signed in.');

  const { data, error } = await getSupabase()
    .from('reminders')
    .insert({
      user_id: user.user.id,
      local_time: input.localTime,
      weekdays: input.weekdays,
      enabled: true,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return toReminder(data as ReminderRow);
}

export async function updateReminder(
  id: string,
  patch: { localTime?: string; weekdays?: number[]; enabled?: boolean },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.localTime !== undefined) row.local_time = patch.localTime;
  if (patch.weekdays !== undefined) row.weekdays = patch.weekdays;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;

  const { error } = await getSupabase().from('reminders').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteReminder(id: string): Promise<void> {
  const { error } = await getSupabase().from('reminders').delete().eq('id', id);
  if (error) throw error;
}

/*
 * Re-exported from the shared package, where they moved once activity schedules needed them too.
 *
 * Kept exported from here so the reminder components' imports did not all have to change, and because this is
 * still the natural place to look for them when working on reminders.
 */
export { WEEKDAY_LABELS, describeWeekdays } from '@fastr/shared';
