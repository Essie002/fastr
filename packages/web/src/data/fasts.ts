import type { CompletedFast, Fast } from '@fastr/shared';
import { getSupabase } from './supabase.js';

/**
 * Reading and writing fasts.
 *
 * As with the profile, the snake_case-to-camelCase mapping lives here and nowhere else. Doing it at each
 * call site is how `ended_at` gets read as `undefined` on one screen and works on another.
 */

interface FastRow {
  id: string;
  user_id: string;
  plan_id: string;
  goal_minutes: number;
  start_at: string;
  ended_at: string | null;
  status: 'active' | 'completed' | 'ended_early';
  mood: number | null;
  energy: number | null;
  note: string | null;
}

const COLUMNS =
  'id, user_id, plan_id, goal_minutes, start_at, ended_at, status, mood, energy, note';

export function toFast(row: FastRow): Fast {
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    goalMinutes: row.goal_minutes,
    startAt: row.start_at,
    endedAt: row.ended_at,
    status: row.status,
    mood: row.mood,
    energy: row.energy,
    note: row.note,
  };
}

export const activeFastQueryKey = ['fasts', 'active'] as const;
export const fastHistoryQueryKey = ['fasts', 'history'] as const;

/**
 * The one fast in progress, or null.
 *
 * `maybeSingle` rather than `single`: no active fast is the normal state, and `single` treats it as an
 * error. The database guarantees there is at most one, so there is no ordering to worry about here.
 */
export async function fetchActiveFast(): Promise<Fast | null> {
  const { data, error } = await getSupabase()
    .from('fasts')
    .select(COLUMNS)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return data ? toFast(data as FastRow) : null;
}

export interface StartFastInput {
  planId: string;
  goalMinutes: number;
  /** Omitted means now. A backdated start, which the trigger bounds to 48 hours. */
  startAt?: string;
}

export async function startFast(input: StartFastInput): Promise<Fast> {
  const { data: user } = await getSupabase().auth.getUser();
  if (!user.user) throw new Error('Not signed in.');

  const { data, error } = await getSupabase()
    .from('fasts')
    .insert({
      // Required by the insert policy's `with check (user_id = auth.uid())`. The policy is what makes
      // this safe; sending it is just what the policy compares against.
      user_id: user.user.id,
      plan_id: input.planId,
      goal_minutes: input.goalMinutes,
      start_at: input.startAt ?? new Date().toISOString(),
      status: 'active',
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return toFast(data as FastRow);
}

export interface AddPastFastInput {
  planId: string;
  goalMinutes: number;
  startAt: string;
  endedAt: string;
}

/**
 * Logs a fast that has already finished. Requirement 9.4.
 *
 * Inserted as a finished fast in one statement rather than started and then ended. Two reasons: the
 * 48-hour backdating limit applies to *starting* a fast, so the two-step version would refuse anything older
 * than two days, and an insert that is `active` for a moment would trip the one-active-fast rule for anyone
 * with a fast already running.
 */
export async function addPastFast(input: AddPastFastInput): Promise<Fast> {
  const { data: user } = await getSupabase().auth.getUser();
  if (!user.user) throw new Error('Not signed in.');

  const actualMinutes = minutesOf(input.startAt, input.endedAt);

  const { data, error } = await getSupabase()
    .from('fasts')
    .insert({
      user_id: user.user.id,
      plan_id: input.planId,
      goal_minutes: input.goalMinutes,
      start_at: input.startAt,
      ended_at: input.endedAt,
      status: actualMinutes >= input.goalMinutes ? 'completed' : 'ended_early',
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return toFast(data as FastRow);
}

function minutesOf(startAt: string, endedAt: string): number {
  return (Date.parse(endedAt) - Date.parse(startAt)) / 60_000;
}

export interface EndFastInput {
  id: string;
  /** Whether the goal was reached. Decided by the caller from the elapsed time it is showing. */
  metGoal: boolean;
  endedAt?: string;
  mood?: number | null;
  energy?: number | null;
  note?: string | null;
}

export async function endFast(input: EndFastInput): Promise<Fast> {
  const patch: Record<string, unknown> = {
    ended_at: input.endedAt ?? new Date().toISOString(),
    // Requirement 5.8. `completed` when the goal was reached, `ended_early` when it was not — the
    // distinction the stats screen's completion rate is built on.
    status: input.metGoal ? 'completed' : 'ended_early',
  };
  if (input.mood !== undefined) patch.mood = input.mood;
  if (input.energy !== undefined) patch.energy = input.energy;
  if (input.note !== undefined) patch.note = input.note;

  const { data, error } = await getSupabase()
    .from('fasts')
    .update(patch)
    .eq('id', input.id)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return toFast(data as FastRow);
}

/** Requirement 5.10. Discards a fast rather than recording it as ended early. */
export async function cancelFast(id: string): Promise<void> {
  const { error } = await getSupabase().from('fasts').delete().eq('id', id);
  if (error) throw error;
}

export interface EditFastInput {
  id: string;
  startAt?: string;
  endedAt?: string | null;
  goalMinutes?: number;
  status?: 'completed' | 'ended_early';
  mood?: number | null;
  energy?: number | null;
  note?: string | null;
}

export async function editFast(input: EditFastInput): Promise<Fast> {
  const patch: Record<string, unknown> = {};
  if (input.startAt !== undefined) patch.start_at = input.startAt;
  if (input.endedAt !== undefined) patch.ended_at = input.endedAt;
  if (input.goalMinutes !== undefined) patch.goal_minutes = input.goalMinutes;
  if (input.status !== undefined) patch.status = input.status;
  if (input.mood !== undefined) patch.mood = input.mood;
  if (input.energy !== undefined) patch.energy = input.energy;
  if (input.note !== undefined) patch.note = input.note;

  const { data, error } = await getSupabase()
    .from('fasts')
    .update(patch)
    .eq('id', input.id)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return toFast(data as FastRow);
}

/** Finished fasts, newest first. Keyset pagination, so a long history stays fast. */
export async function fetchFastHistory(
  // `| undefined` spelled out because `exactOptionalPropertyTypes` is on, and the cursor is genuinely absent
  // on the first page rather than merely unspecified.
  options: { before?: string | undefined; limit?: number | undefined } = {},
): Promise<CompletedFast[]> {
  let query = getSupabase()
    .from('fasts')
    .select(COLUMNS)
    .neq('status', 'active')
    .order('ended_at', { ascending: false })
    .limit(options.limit ?? 25);

  // Keyset rather than offset: an offset re-reads and re-sorts everything it skips, and shifts under you
  // when a row is added while paging.
  if (options.before) query = query.lt('ended_at', options.before);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => toFast(row as FastRow) as CompletedFast);
}

export async function deleteFast(id: string): Promise<void> {
  const { error } = await getSupabase().from('fasts').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Turns a database error into a sentence. Requirement 5.9 and the error-handling table in the design.
 *
 * The overlap constraint is the one that matters: its native message names a gist exclusion constraint and
 * prints two tstzranges, which is meaningless to someone who just wants to log yesterday's fast.
 */
export function describeFastError(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

  if (/fasts_no_overlap/.test(message)) {
    return 'That overlaps a fast you have already logged. Check the times and try again.';
  }
  if (/fasts_one_active_per_user/.test(message)) {
    return 'You already have a fast running.';
  }
  if (/goal_minutes/.test(message)) {
    return 'A fast has to be between 1 and 72 hours.';
  }
  if (/fast_end_matches_status/.test(message)) {
    return 'A fast cannot end before it started.';
  }
  if (/cannot start in the future/.test(message)) {
    return 'A fast cannot start in the future.';
  }
  if (/more than 48 hours ago/.test(message)) {
    return 'A fast you are starting now cannot have begun more than 48 hours ago.';
  }
  return 'That did not save. Check your connection and try again.';
}
