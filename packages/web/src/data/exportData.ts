import type { FastrExport } from '@fastr/shared';
import { getSupabase } from './supabase.js';

/**
 * Taking your data out. Requirement 16.
 *
 * Built in the browser rather than in a function, because the client already has permission to read exactly its own
 * rows — that is what RLS guarantees — so an export needs no elevated access. Requirement 16.2's exclusions come
 * for free: there is no policy letting the client read auth data, and push subscriptions are simply not queried.
 *
 * This matters more here than in most apps. A free Supabase project pauses after a week of inactivity, so an export
 * is the difference between "my data is temporarily unreachable" and "my data is gone".
 */

export async function buildExport(): Promise<FastrExport> {
  const supabase = getSupabase();

  const [profile, fasts, weights, water, dayNotes, reminders, activities, activityLog] =
    await Promise.all([
      supabase
        .from('profiles')
        .select(
          'display_name, time_zone, weight_unit, volume_unit, theme, default_plan_id, custom_goal_minutes, water_goal_ml, notify_goal, notify_stages, notify_hour_before, notify_activities',
        )
        .maybeSingle(),
      supabase
        .from('fasts')
        .select('plan_id, goal_minutes, start_at, ended_at, status, mood, energy, note')
        .order('start_at', { ascending: true }),
      supabase.from('weight_entries').select('measured_on, grams').order('measured_on'),
      supabase.from('water_entries').select('logged_at, ml').order('logged_at'),
      supabase.from('day_notes').select('day, mood, energy, note').order('day'),
      supabase.from('reminders').select('local_time, weekdays, enabled').order('local_time'),
      supabase
        .from('activities')
        .select(
          'type_key, custom_label, duration_minutes, notify_end, enabled, activity_schedules (kind, local_time, window_start, window_end, interval_minutes, weekdays, enabled)',
        )
        .order('created_at'),
      supabase
        .from('activity_log')
        .select('label, type_key, occurred_at, minutes, note')
        .order('occurred_at'),
    ]);

  const firstError =
    profile.error ??
    fasts.error ??
    weights.error ??
    water.error ??
    dayNotes.error ??
    reminders.error ??
    activities.error ??
    activityLog.error;
  if (firstError) throw firstError;

  const row = profile.data as Record<string, unknown> | null;

  return {
    // Bumped if the shape ever changes, so an importer can tell what it is looking at rather than guessing.
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: row
      ? {
          displayName: row.display_name as string,
          timeZone: row.time_zone as string,
          weightUnit: row.weight_unit as 'kg' | 'lb',
          volumeUnit: row.volume_unit as 'ml' | 'floz',
          theme: row.theme as 'light' | 'dark' | 'system',
          defaultPlanId: row.default_plan_id as string,
          customGoalMinutes: row.custom_goal_minutes as number | null,
          waterGoalMl: row.water_goal_ml as number,
          notifyGoal: row.notify_goal as boolean,
          notifyStages: row.notify_stages as boolean,
          notifyHourBefore: row.notify_hour_before as boolean,
          notifyActivities: row.notify_activities as boolean,
        }
      : {},
    fasts: (fasts.data ?? []).map((fast) => {
      const typed = fast as Record<string, unknown>;
      return {
        planId: typed.plan_id as string,
        goalMinutes: typed.goal_minutes as number,
        startAt: typed.start_at as string,
        endedAt: typed.ended_at as string | null,
        status: typed.status as 'active' | 'completed' | 'ended_early',
        mood: typed.mood as number | null,
        energy: typed.energy as number | null,
        note: typed.note as string | null,
      };
    }),
    weightEntries: (weights.data ?? []).map((entry) => {
      const typed = entry as Record<string, unknown>;
      return { measuredOn: typed.measured_on as string, grams: typed.grams as number };
    }),
    waterEntries: (water.data ?? []).map((entry) => {
      const typed = entry as Record<string, unknown>;
      return { loggedAt: typed.logged_at as string, ml: typed.ml as number };
    }),
    dayNotes: (dayNotes.data ?? []).map((note) => {
      const typed = note as Record<string, unknown>;
      return {
        day: typed.day as string,
        mood: typed.mood as number | null,
        energy: typed.energy as number | null,
        note: typed.note as string | null,
      };
    }),
    reminders: (reminders.data ?? []).map((reminder) => {
      const typed = reminder as Record<string, unknown>;
      return {
        localTime: (typed.local_time as string).slice(0, 5),
        weekdays: typed.weekdays as number[],
        enabled: typed.enabled as boolean,
      };
    }),

    /*
     * Activities with their schedules nested, which is how they are restored: a schedule is meaningless
     * without its parent, and a flat list of both would need ids in the file to reconnect them. Nesting keeps
     * the export free of database ids entirely, so importing into a different account cannot collide.
     */
    activities: (activities.data ?? []).map((activity) => {
      const typed = activity as Record<string, unknown>;
      const schedules = (typed.activity_schedules as Record<string, unknown>[] | null) ?? [];

      return {
        typeKey: typed.type_key as string | null,
        customLabel: typed.custom_label as string | null,
        durationMinutes: typed.duration_minutes as number,
        notifyEnd: typed.notify_end as boolean,
        enabled: typed.enabled as boolean,
        schedules: schedules.map((schedule) =>
          // Discriminated on `kind`, with the other shape's fields omitted rather than set to null. The
          // schema forbids them being present, which is what keeps an exported file importable.
          schedule.kind === 'at'
            ? {
                kind: 'at' as const,
                localTime: (schedule.local_time as string).slice(0, 5),
                weekdays: schedule.weekdays as number[],
                enabled: schedule.enabled as boolean,
              }
            : {
                kind: 'every' as const,
                windowStart: (schedule.window_start as string).slice(0, 5),
                windowEnd: (schedule.window_end as string).slice(0, 5),
                intervalMinutes: schedule.interval_minutes as number,
                weekdays: schedule.weekdays as number[],
                enabled: schedule.enabled as boolean,
              },
        ),
      };
    }),

    activityLog: (activityLog.data ?? []).map((entry) => {
      const typed = entry as Record<string, unknown>;
      return {
        label: typed.label as string,
        typeKey: typed.type_key as string | null,
        occurredAt: typed.occurred_at as string,
        minutes: typed.minutes as number | null,
        note: typed.note as string | null,
      };
    }),
  };
}

/**
 * The fasts as CSV. Requirement 16.1.
 *
 * Alongside the JSON rather than instead of it: JSON round-trips back into Fastr, and CSV opens in a spreadsheet,
 * which is what someone wants when they are looking for a pattern Fastr does not show them.
 */
export function fastsToCsv(data: FastrExport): string {
  const header = [
    'started_at',
    'ended_at',
    'plan',
    'goal_minutes',
    'actual_minutes',
    'met_goal',
    'status',
    'mood',
    'energy',
    'note',
  ];

  const rows = data.fasts
    .filter((fast) => fast.endedAt !== null)
    .map((fast) => {
      const actual = Math.round((Date.parse(fast.endedAt!) - Date.parse(fast.startAt)) / 60_000);
      return [
        fast.startAt,
        fast.endedAt!,
        fast.planId,
        String(fast.goalMinutes),
        String(actual),
        actual >= fast.goalMinutes ? 'yes' : 'no',
        fast.status,
        fast.mood === null ? '' : String(fast.mood),
        fast.energy === null ? '' : String(fast.energy),
        fast.note ?? '',
      ];
    });

  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

/**
 * Escapes one CSV field.
 *
 * Quotes anything containing a comma, a quote or a newline — all three are possible in a free-text note, and an
 * unescaped newline there silently splits one fast across two rows.
 *
 * The leading apostrophe on a value starting with `=`, `+`, `-` or `@` is deliberate: spreadsheets treat those as
 * formulas, so a note beginning "=" becomes an executable cell. That is CSV injection, and a fasting note is
 * user-controlled text going into a file the user will open in Excel.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Triggers a download without a server. */
export function downloadFile(filename: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Released on the next turn: revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportFilename(extension: string): string {
  return `fastr-export-${new Date().toISOString().slice(0, 10)}.${extension}`;
}
