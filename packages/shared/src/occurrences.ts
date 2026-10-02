/**
 * When a schedule next fires. Requirement 7.4.
 *
 * This duplicates `activity_occurrences` in SQL, and that is a deliberate and uncomfortable choice. The
 * activities list shows "next at 07:00 tomorrow" for every row, and the alternative to computing it here is a
 * round trip per render — for a number whose only job is to let someone spot a misconfigured schedule before
 * it misfires rather than after.
 *
 * The duplication is made safe the only way duplication can be: a test drives the same fixtures through both
 * this function and the SQL one and asserts they agree. That is the same bargain the project already makes for
 * validation rules, where Zod and the Postgres constraints are two statements of one rule with a parity test
 * between them.
 *
 * Everything here works in the user's wall clock, derived with `Intl` rather than by arithmetic on offsets.
 * Adding minutes to a local time and hoping is how a schedule ends up an hour out twice a year.
 */

export interface ScheduleShape {
  kind: 'at' | 'every';
  /** `HH:MM`, when `kind` is 'at'. */
  localTime?: string | null;
  /** `HH:MM`, when `kind` is 'every'. */
  windowStart?: string | null;
  windowEnd?: string | null;
  intervalMinutes?: number | null;
  weekdays: readonly number[];
  enabled?: boolean;
}

/** Minutes since midnight for an `HH:MM` string. */
function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours! * 60 + minutes!;
}

/** The parts of an instant in a named zone: calendar date, weekday, and minutes since local midnight. */
function localParts(
  at: Date,
  timeZone: string,
): { date: string; weekday: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdays.indexOf(parts.weekday!),
    // `hour` can be '24' at midnight in some locales; modulo keeps it inside the day.
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

/**
 * The instant at which a given wall-clock time falls on a given local date, in a zone.
 *
 * Found by probing rather than by offset arithmetic: guess UTC, read back what wall clock that lands on in the
 * zone, and correct by the difference. Two passes settle it, including across a daylight saving change, where
 * the offset the answer needs is not the offset the guess had.
 */
function instantAt(localDate: string, minutes: number, timeZone: string): Date {
  const [year, month, day] = localDate.split('-').map(Number);
  let guess = Date.UTC(year!, month! - 1, day!, Math.floor(minutes / 60), minutes % 60);

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = localParts(new Date(guess), timeZone);
    const dayDelta =
      (Date.UTC(...(localDate.split('-').map(Number) as [number, number, number])) -
        Date.UTC(...(parts.date.split('-').map(Number) as [number, number, number]))) /
      86_400_000;
    const drift = minutes - parts.minutes + dayDelta * 1440;
    if (drift === 0) break;
    guess += drift * 60_000;
  }

  return new Date(guess);
}

/** Every time, in minutes since midnight, that an interval schedule fires on a day it applies to. */
function slotsFor(schedule: ScheduleShape): number[] {
  const start = minutesOfDay(schedule.windowStart!);
  const end = minutesOfDay(schedule.windowEnd!);
  const step = schedule.intervalMinutes!;

  const slots: number[] = [];
  // `<=` so the window end is included when it lands exactly on a step, matching generate_series.
  for (let at = start; at <= end; at += step) slots.push(at);
  return slots;
}

/**
 * The next time this schedule fires at or after `from`, or null if it never does.
 *
 * Looks ahead eight days, which is one more than the longest possible gap: a schedule on a single weekday
 * fires once every seven, and the extra day absorbs the case where today's occurrence has already passed.
 */
export function nextOccurrence(schedule: ScheduleShape, from: Date, timeZone: string): Date | null {
  if (schedule.enabled === false) return null;
  if (schedule.weekdays.length === 0) return null;

  const times = schedule.kind === 'at' ? [minutesOfDay(schedule.localTime!)] : slotsFor(schedule);
  if (times.length === 0) return null;

  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    // Stepping by whole days through UTC and then asking the zone what day that is: safe because a
    // 24-hour step never skips a calendar day, even when one of them is 23 or 25 hours long.
    const probe = new Date(from.getTime() + dayOffset * 86_400_000);
    const { date, weekday } = localParts(probe, timeZone);

    if (!schedule.weekdays.includes(weekday)) continue;

    for (const minutes of times) {
      const candidate = instantAt(date, minutes, timeZone);
      if (candidate.getTime() >= from.getTime()) return candidate;
    }
  }

  return null;
}
