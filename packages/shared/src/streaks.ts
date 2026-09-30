import type { CompletedFast, LocalDate, Stats, TimeZone } from './types.js';
import { addDays, localDayOf, minutesBetween } from './time.js';

/**
 * Streaks and stats. Requirement 10.
 *
 * Every function takes the current instant as a parameter rather than reading the clock. A function
 * that reads the clock itself can only be tested by faking the clock; one that takes it can be
 * tested by passing a date, which is why Requirement 10.6's property tests are short.
 *
 * Requirement 10.5 is why none of this is stored: streaks are derived on every read, so editing
 * history can never leave a counter behind that disagrees with the fasts.
 */

/** The actual length of a finished fast, which may be more or less than its goal. */
export function actualMinutes(fast: CompletedFast): number {
  return minutesBetween(fast.startAt, fast.endedAt);
}

/** Requirement 10.1: only a fast that reached its goal counts. */
export function metGoal(fast: CompletedFast): boolean {
  return actualMinutes(fast) >= fast.goalMinutes;
}

/**
 * The distinct local days on which the user completed a fast that met its goal.
 *
 * Requirement 10.3: a fast counts toward the day it *ended*, in the user's zone. A 20-hour fast
 * starting at 14:00 on Monday ends on Tuesday and belongs to Tuesday.
 */
function qualifyingDays(fasts: readonly CompletedFast[], timeZone: TimeZone): Set<LocalDate> {
  const days = new Set<LocalDate>();
  for (const fast of fasts) {
    if (metGoal(fast)) days.add(localDayOf(fast.endedAt, timeZone));
  }
  return days;
}

/**
 * Consecutive days ending today or yesterday. Requirement 10.1.
 *
 * "or yesterday" is the difference between a number that feels fair and one that feels punitive:
 * without it, a user who has not yet finished today's fast watches their streak read zero from
 * midnight until they end it, which makes the number untrustworthy exactly when they are looking
 * at it.
 */
export function currentStreak(
  fasts: readonly CompletedFast[],
  timeZone: TimeZone,
  now: Date,
): number {
  const days = qualifyingDays(fasts, timeZone);
  if (days.size === 0) return 0;

  const today = localDayOf(now, timeZone);
  let cursor = days.has(today) ? today : addDays(today, -1);
  if (!days.has(cursor)) return 0;

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** The longest run of consecutive qualifying days ever. Requirement 10.2. */
export function longestStreak(fasts: readonly CompletedFast[], timeZone: TimeZone): number {
  const days = qualifyingDays(fasts, timeZone);
  if (days.size === 0) return 0;

  let longest = 0;
  for (const day of days) {
    // Count only from the start of a run, so each run is walked once rather than once per day in it.
    if (days.has(addDays(day, -1))) continue;
    let length = 0;
    let cursor = day;
    while (days.has(cursor)) {
      length += 1;
      cursor = addDays(cursor, 1);
    }
    if (length > longest) longest = length;
  }
  return longest;
}

function averageOfLast(
  fasts: readonly CompletedFast[],
  now: Date,
  windowDays: number,
): number | null {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60_000;
  const lengths = fasts
    .filter((fast) => Date.parse(fast.endedAt) >= cutoff)
    .map((fast) => actualMinutes(fast));
  if (lengths.length === 0) return null;
  return Math.round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length);
}

/** Requirement 10.4. */
export function stats(fasts: readonly CompletedFast[], now: Date): Stats {
  if (fasts.length === 0) {
    return {
      totalCompleted: 0,
      averageMinutesLast7: null,
      averageMinutesLast30: null,
      longestMinutes: null,
      goalCompletionRate: null,
    };
  }

  const lengths = fasts.map((fast) => actualMinutes(fast));
  const met = fasts.filter((fast) => metGoal(fast)).length;

  return {
    // "Completed" here means met its goal, matching what the streak counts, so the two numbers on
    // the stats screen cannot tell different stories.
    totalCompleted: met,
    averageMinutesLast7: averageOfLast(fasts, now, 7),
    averageMinutesLast30: averageOfLast(fasts, now, 30),
    longestMinutes: Math.max(...lengths),
    goalCompletionRate: met / fasts.length,
  };
}
