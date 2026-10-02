import type { ActivityScheduleInput } from '@fastr/shared';
import { getSupabase } from './supabase.js';

/**
 * Activities and their schedules. Requirements 1, 2, 3, 7.
 *
 * Note the deliberate overlap with `data/reminders.ts`, which schedules the one fasting reminder. Requirement
 * 13 records why they are separate: merging would need a data migration and would change the export format,
 * breaking every file already downloaded, and the fasting reminder's "not while a fast is running" rule does
 * not generalise to anything else. See the header of `components/Reminders.tsx` for the full reasoning.
 *
 * Schedules are fetched nested with their activity in one query, because every screen that shows an activity
 * also shows when it happens — fetching them separately would mean two round trips and a moment where a row
 * renders with no schedule, which reads as "this never fires".
 *
 * Times are wall clock throughout. The database resolves them against the profile's zone when it queues, so
 * nothing here converts anything; a `Date` in this file would be a bug.
 */

export interface ActivitySchedule {
  id: string;
  kind: 'at' | 'every';
  /** Set when `kind` is 'at'. `HH:MM`. */
  localTime: string | null;
  /** Set when `kind` is 'every'. `HH:MM`. */
  windowStart: string | null;
  windowEnd: string | null;
  intervalMinutes: number | null;
  weekdays: number[];
  enabled: boolean;
}

export interface Activity {
  id: string;
  typeKey: string | null;
  customLabel: string | null;
  durationMinutes: number;
  notifyEnd: boolean;
  enabled: boolean;
  schedules: ActivitySchedule[];
}

interface ScheduleRow {
  id: string;
  kind: 'at' | 'every';
  local_time: string | null;
  window_start: string | null;
  window_end: string | null;
  interval_minutes: number | null;
  weekdays: number[];
  enabled: boolean;
}

interface ActivityRow {
  id: string;
  type_key: string | null;
  custom_label: string | null;
  duration_minutes: number;
  notify_end: boolean;
  enabled: boolean;
  activity_schedules: ScheduleRow[] | null;
}

const SCHEDULE_COLUMNS =
  'id, kind, local_time, window_start, window_end, interval_minutes, weekdays, enabled';

const COLUMNS = `id, type_key, custom_label, duration_minutes, notify_end, enabled, activity_schedules (${SCHEDULE_COLUMNS})`;

export const activitiesQueryKey = ['activities'] as const;

/** Postgres returns `time` as `HH:MM:SS`; every control and comparison here wants `HH:MM`. */
const toWallClock = (value: string | null) => (value === null ? null : value.slice(0, 5));

function toSchedule(row: ScheduleRow): ActivitySchedule {
  return {
    id: row.id,
    kind: row.kind,
    localTime: toWallClock(row.local_time),
    windowStart: toWallClock(row.window_start),
    windowEnd: toWallClock(row.window_end),
    intervalMinutes: row.interval_minutes,
    weekdays: row.weekdays,
    enabled: row.enabled,
  };
}

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    typeKey: row.type_key,
    customLabel: row.custom_label,
    durationMinutes: row.duration_minutes,
    notifyEnd: row.notify_end,
    enabled: row.enabled,
    schedules: (row.activity_schedules ?? [])
      .map(toSchedule)
      // Earliest first, so a list reads down the day. Interval schedules sort by their window start.
      .sort((a, b) =>
        (a.localTime ?? a.windowStart ?? '').localeCompare(b.localTime ?? b.windowStart ?? ''),
      ),
  };
}

export async function fetchActivities(): Promise<Activity[]> {
  const { data, error } = await getSupabase()
    .from('activities')
    .select(COLUMNS)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => toActivity(row as unknown as ActivityRow));
}

export async function createActivity(input: {
  typeKey: string | null;
  customLabel: string | null;
  durationMinutes: number;
  notifyEnd: boolean;
}): Promise<Activity> {
  const { data: user } = await getSupabase().auth.getUser();
  if (!user.user) throw new Error('Not signed in.');

  const { data, error } = await getSupabase()
    .from('activities')
    .insert({
      // Required by the insert policy's `with check (user_id = auth.uid())`. The policy is what makes this
      // safe; sending it is only what the policy compares against.
      user_id: user.user.id,
      type_key: input.typeKey,
      custom_label: input.customLabel,
      duration_minutes: input.durationMinutes,
      notify_end: input.notifyEnd,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return toActivity(data as unknown as ActivityRow);
}

export async function updateActivity(
  id: string,
  patch: {
    typeKey?: string | null;
    customLabel?: string | null;
    durationMinutes?: number;
    notifyEnd?: boolean;
    enabled?: boolean;
  },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.typeKey !== undefined) row.type_key = patch.typeKey;
  if (patch.customLabel !== undefined) row.custom_label = patch.customLabel;
  if (patch.durationMinutes !== undefined) row.duration_minutes = patch.durationMinutes;
  if (patch.notifyEnd !== undefined) row.notify_end = patch.notifyEnd;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;

  const { error } = await getSupabase().from('activities').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteActivity(id: string): Promise<void> {
  // Schedules cascade; completions do not — `activity_log.activity_id` is `on delete set null`, because
  // deleting the reminder is not a claim that the walk never happened (Requirement 1.6).
  const { error } = await getSupabase().from('activities').delete().eq('id', id);
  if (error) throw error;
}

/** The database column names for one schedule shape. Null for the other shape's fields, as the CHECK demands. */
function scheduleRowFor(input: ActivityScheduleInput): Record<string, unknown> {
  if (input.kind === 'at') {
    return {
      kind: 'at',
      local_time: input.localTime,
      window_start: null,
      window_end: null,
      interval_minutes: null,
      weekdays: input.weekdays,
      enabled: input.enabled,
    };
  }
  return {
    kind: 'every',
    local_time: null,
    window_start: input.windowStart,
    window_end: input.windowEnd,
    interval_minutes: input.intervalMinutes,
    weekdays: input.weekdays,
    enabled: input.enabled,
  };
}

export async function createSchedule(
  activityId: string,
  input: ActivityScheduleInput,
): Promise<void> {
  // `user_id` is deliberately not sent: a trigger takes it from the parent activity. Supplying it here would
  // be ignored, and relying on it would be a hole — see the RLS test that forges one.
  const { error } = await getSupabase()
    .from('activity_schedules')
    .insert({ activity_id: activityId, ...scheduleRowFor(input) });
  if (error) throw error;
}

export async function updateSchedule(id: string, input: ActivityScheduleInput): Promise<void> {
  // Replaced wholesale rather than patched, because changing shape means nulling the other shape's columns
  // and a partial patch would leave the row failing `schedule_shape`.
  const { error } = await getSupabase()
    .from('activity_schedules')
    .update(scheduleRowFor(input))
    .eq('id', id);
  if (error) throw error;
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await getSupabase().from('activity_schedules').update({ enabled }).eq('id', id);
  if (error) throw error;
}

export async function deleteSchedule(id: string): Promise<void> {
  const { error } = await getSupabase().from('activity_schedules').delete().eq('id', id);
  if (error) throw error;
}
