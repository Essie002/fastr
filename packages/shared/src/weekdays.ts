/**
 * Weekdays, and how to describe a set of them in words.
 *
 * Here rather than in the web app's data layer because two features now need it — the fasting reminder and
 * activity schedules — and because the Edge Functions may yet want to say "Weekdays" in a notification. Two
 * copies of this would drift in the worst possible way: the UI promising "Weekdays" while the scheduler
 * queues Sunday.
 *
 * 0 is Sunday throughout, matching Postgres `extract(dow from ...)`, which is what both scheduling functions
 * compare against. Picking the other convention would mean translating on every read, and the translation is
 * exactly where an off-by-one lives.
 */

export interface WeekdayLabel {
  value: number;
  short: string;
  long: string;
}

export const WEEKDAY_LABELS: readonly WeekdayLabel[] = [
  { value: 0, short: 'S', long: 'Sunday' },
  { value: 1, short: 'M', long: 'Monday' },
  { value: 2, short: 'T', long: 'Tuesday' },
  { value: 3, short: 'W', long: 'Wednesday' },
  { value: 4, short: 'T', long: 'Thursday' },
  { value: 5, short: 'F', long: 'Friday' },
  { value: 6, short: 'S', long: 'Saturday' },
];

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
