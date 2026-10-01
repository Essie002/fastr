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

/** 0 is Sunday, matching Postgres `extract(dow)`, which is what the queueing job compares against. */
export const WEEKDAY_LABELS = [
  { value: 0, short: 'S', long: 'Sunday' },
  { value: 1, short: 'M', long: 'Monday' },
  { value: 2, short: 'T', long: 'Tuesday' },
  { value: 3, short: 'W', long: 'Wednesday' },
  { value: 4, short: 'T', long: 'Thursday' },
  { value: 5, short: 'F', long: 'Friday' },
  { value: 6, short: 'S', long: 'Saturday' },
] as const;

/** "Every day", "Weekdays", or a list. Shorter to read than seven letters on a screen. */
export function describeWeekdays(weekdays: readonly number[]): string {
  const sorted = [...weekdays].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Every day';
  if (sorted.join(',') === '1,2,3,4,5') return 'Weekdays';
  if (sorted.join(',') === '0,6') return 'Weekends';
  return sorted
    .map((day) => WEEKDAY_LABELS.find((label) => label.value === day)?.long ?? '')
    .filter(Boolean)
    .join(', ');
}
