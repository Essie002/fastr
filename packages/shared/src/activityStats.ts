import type { Instant, TimeZone } from './types.js';
import { addDays, localDayOf } from './time.js';

/**
 * Counts and streaks for recorded activities. Requirement 6.
 *
 * Computed from completions only, never from reminders sent (Requirement 6.4). That distinction is the whole
 * point: a number built from reminders would describe what Fastr suggested, and the user already knows what it
 * suggested — they were there when it buzzed. What they do not know is what they actually did.
 *
 * Days are the user's local days throughout, so a swim at 23:50 counts for the day it felt like.
 */

export interface ActivityCompletionLike {
  label: string;
  typeKey: string | null;
  occurredAt: Instant;
  minutes: number | null;
}

export interface ActivityTotals {
  label: string;
  typeKey: string | null;
  last7: number;
  last30: number;
  totalMinutes: number;
}

/**
 * Per-activity counts and time, newest activity first by recent volume.
 *
 * Grouped by label rather than by `activity_id`, because a completion survives the activity being deleted and
 * its id becomes null. Grouping by id would silently drop that history into an "unknown" bucket, which is the
 * opposite of what keeping it was for.
 */
export function activityTotals(
  completions: readonly ActivityCompletionLike[],
  now: Date,
): ActivityTotals[] {
  const sevenDaysAgo = now.getTime() - 7 * 86_400_000;
  const thirtyDaysAgo = now.getTime() - 30 * 86_400_000;

  const groups = new Map<string, ActivityTotals>();

  for (const completion of completions) {
    const at = Date.parse(completion.occurredAt);
    const existing = groups.get(completion.label) ?? {
      label: completion.label,
      typeKey: completion.typeKey,
      last7: 0,
      last30: 0,
      totalMinutes: 0,
    };

    if (at >= sevenDaysAgo) existing.last7 += 1;
    if (at >= thirtyDaysAgo) {
      existing.last30 += 1;
      // Scoped to thirty days, matching the count beside it. A lifetime total next to a 30-day count would
      // invite the reader to compare two different periods.
      existing.totalMinutes += completion.minutes ?? 0;
    }

    groups.set(completion.label, existing);
  }

  return [...groups.values()].sort((a, b) => b.last30 - a.last30 || a.label.localeCompare(b.label));
}

/**
 * Consecutive local days ending today or yesterday with at least one completion. Requirement 6.3.
 *
 * Yesterday counts as the end of a live streak, for the same reason the fasting streak allows it: a day is not
 * over until it is over, and a streak that resets at midnight would tell someone at 9am that they had lost
 * something they still had all day to keep.
 */
export function activityStreak(
  completions: readonly ActivityCompletionLike[],
  timeZone: TimeZone,
  now: Date,
): number {
  const days = new Set(completions.map((item) => localDayOf(item.occurredAt, timeZone)));
  if (days.size === 0) return 0;

  const today = localDayOf(now, timeZone);
  const yesterday = addDays(today, -1);

  let cursor = days.has(today) ? today : days.has(yesterday) ? yesterday : null;
  if (cursor === null) return 0;

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

/** Completions bucketed by local day, newest day first, each day's entries newest first. */
export function groupByLocalDay<T extends ActivityCompletionLike>(
  completions: readonly T[],
  timeZone: TimeZone,
): { day: string; items: T[] }[] {
  const groups = new Map<string, T[]>();

  for (const completion of completions) {
    const day = localDayOf(completion.occurredAt, timeZone);
    groups.set(day, [...(groups.get(day) ?? []), completion]);
  }

  return [...groups.entries()]
    .map(([day, items]) => ({
      day,
      items: [...items].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
    }))
    .sort((a, b) => b.day.localeCompare(a.day));
}
