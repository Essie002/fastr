import type { Profile } from '@fastr/shared';
import { getSupabase } from './supabase.js';

/**
 * Reading and writing the signed-in user's profile.
 *
 * One module per table rather than a hook per screen: settings, the timer and the plan catalog all need
 * the profile, and a per-screen hook guarantees three copies of this mapping that drift.
 *
 * The mapping itself is the point of the file. Postgres columns are snake_case and the domain types are
 * camelCase, and doing that conversion inline at each call site is how `custom_goal_minutes` ends up
 * read as `undefined` on one screen and works on another.
 */

/** The shape Postgres returns. Kept local: nothing outside this module should see snake_case. */
interface ProfileRow {
  id: string;
  display_name: string;
  time_zone: string;
  weight_unit: 'kg' | 'lb';
  volume_unit: 'ml' | 'floz';
  theme: 'light' | 'dark' | 'system';
  default_plan_id: string;
  custom_goal_minutes: number | null;
  water_goal_ml: number;
  notify_goal: boolean;
  notify_stages: boolean;
  notify_hour_before: boolean;
  health_notice_at: string | null;
}

const COLUMNS =
  'id, display_name, time_zone, weight_unit, volume_unit, theme, default_plan_id, custom_goal_minutes, water_goal_ml, notify_goal, notify_stages, notify_hour_before, health_notice_at';

export function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    timeZone: row.time_zone,
    weightUnit: row.weight_unit,
    volumeUnit: row.volume_unit,
    theme: row.theme,
    defaultPlanId: row.default_plan_id,
    customGoalMinutes: row.custom_goal_minutes,
    waterGoalMl: row.water_goal_ml,
    notifyGoal: row.notify_goal,
    notifyStages: row.notify_stages,
    notifyHourBefore: row.notify_hour_before,
    healthNoticeAt: row.health_notice_at,
  };
}

/** Only the fields the app ever writes, in database spelling. */
export interface ProfilePatch {
  display_name?: string;
  time_zone?: string;
  weight_unit?: 'kg' | 'lb';
  volume_unit?: 'ml' | 'floz';
  theme?: 'light' | 'dark' | 'system';
  default_plan_id?: string;
  custom_goal_minutes?: number | null;
  water_goal_ml?: number;
  notify_goal?: boolean;
  notify_stages?: boolean;
  notify_hour_before?: boolean;
  health_notice_at?: string | null;
}

export const profileQueryKey = ['profile'] as const;

/**
 * The signed-in user's profile.
 *
 * No `eq('id', ...)` filter: the RLS policy already limits this table to one row, so filtering would
 * restate the security boundary in the client and invite the reader to believe that is what enforces
 * it. `maybeSingle` rather than `single`, because the row is missing for exactly as long as it takes the
 * trigger on `auth.users` to run, and a hard error there would turn a race into a crash.
 */
export async function fetchProfile(): Promise<Profile | null> {
  const { data, error } = await getSupabase().from('profiles').select(COLUMNS).maybeSingle();
  if (error) throw error;
  return data ? toProfile(data as ProfileRow) : null;
}

export async function updateProfile(patch: ProfilePatch): Promise<Profile> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .update(patch)
    // The policy scopes the update, but an UPDATE with no WHERE is a habit worth not forming, and
    // PostgREST needs a filter to return the changed row.
    .neq('id', '00000000-0000-0000-0000-000000000000')
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toProfile(data as ProfileRow);
}

/**
 * Records that the health notice was acknowledged. Requirement 1.5 and 17.1.
 */
export async function acknowledgeHealthNotice(): Promise<Profile> {
  return updateProfile({ health_notice_at: new Date().toISOString() });
}

/**
 * Stores the browser's time zone if the profile is still on the default. Requirement 1.6.
 *
 * Only when it is still `UTC`, which is what the trigger sets when the invite carried no zone. A user
 * who has deliberately chosen a zone in settings must not have it overwritten every time they open the
 * app from a different place, and someone travelling is not the same as someone relocating.
 */
export async function captureTimeZone(profile: Profile): Promise<Profile | null> {
  if (profile.timeZone !== 'UTC') return null;

  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!detected || detected === 'UTC') return null;

  return updateProfile({ time_zone: detected });
}
