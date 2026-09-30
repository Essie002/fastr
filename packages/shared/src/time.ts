import type { Instant, LocalDate, TimeZone } from './types.js';

/**
 * Time-zone arithmetic, with no dependency on a date library.
 *
 * Every function here exists because of one bug: taking the calendar day of an instant with
 * `date.getDate()` or `toISOString().slice(0, 10)` gives the day in the *runtime's* zone, not the
 * user's. A fast ending at 01:00 in Nairobi is 22:00 the previous day in UTC, so the naive version
 * credits the wrong day and silently breaks a streak that should have continued. That is the single
 * most likely wrong-looking-number bug in this app, so the conversion lives in one tested place.
 */

/** `Intl` is the only thing in the platform that knows what a zone offset was on a given date. */
const formatterCache = new Map<TimeZone, Intl.DateTimeFormat>();

function dayFormatter(timeZone: TimeZone): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  // `en-CA` yields `2026-09-30`, which is the ISO order without any manual assembly.
  const created = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  formatterCache.set(timeZone, created);
  return created;
}

/** The calendar day an instant falls on, in the given zone. Requirement 10.3. */
export function localDayOf(instant: Instant | Date, timeZone: TimeZone): LocalDate {
  const date = instant instanceof Date ? instant : new Date(instant);
  return dayFormatter(timeZone).format(date);
}

/**
 * Adds days to a `YYYY-MM-DD` string by calendar arithmetic, not by adding 86,400 seconds.
 *
 * Done with instants, the day before a spring-forward transition is 23 hours earlier, and adding a
 * fixed day to it lands on the same date twice. Working on the date parts avoids the question
 * entirely, which is why streak walking uses this rather than millisecond maths.
 */
export function addDays(day: LocalDate, delta: number): LocalDate {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  // Noon UTC, so a shift of a few hours in either direction cannot cross a date boundary.
  const anchor = new Date(Date.UTC(year, month - 1, date, 12));
  anchor.setUTCDate(anchor.getUTCDate() + delta);
  return anchor.toISOString().slice(0, 10);
}

export function minutesBetween(from: Instant | Date, to: Instant | Date): number {
  const start = from instanceof Date ? from.getTime() : Date.parse(from);
  const end = to instanceof Date ? to.getTime() : Date.parse(to);
  return Math.floor((end - start) / 60_000);
}

/** `16h 02m`, or `45m` under an hour. What the timer and history both show. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

/** `16:00` in the user's own zone. Used for the goal end time, Requirement 5.4. */
export function formatLocalTime(instant: Instant | Date, timeZone: TimeZone): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
