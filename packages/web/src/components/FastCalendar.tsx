import { addDays, localDayOf, type CompletedFast, type TimeZone } from '@fastr/shared';

/**
 * A month grid with the days that hold a completed fast marked. Requirement 9.2.
 *
 * Built as a table rather than a grid of divs: a calendar *is* tabular data, and a table gives row and column
 * headers that a screen reader can use to say "Tuesday 14" instead of reading forty numbers in a row.
 *
 * Each marked day carries a visible dot **and** text in its accessible name, because a dot alone would make
 * colour the only carrier of meaning (Requirement 19.3).
 */
export function FastCalendar({
  fasts,
  timeZone,
  month,
}: {
  fasts: readonly CompletedFast[];
  timeZone: TimeZone;
  /** Any day inside the month to show. */
  month: Date;
}) {
  // Requirement 10.3: a fast belongs to the local day it *ended* on, so the mark lands where the streak
  // counts it rather than where it started.
  const marked = new Set(
    fasts
      .filter(
        (fast) => Date.parse(fast.endedAt) - Date.parse(fast.startAt) >= fast.goalMinutes * 60_000,
      )
      .map((fast) => localDayOf(fast.endedAt, timeZone)),
  );
  const partial = new Set(
    fasts.map((fast) => localDayOf(fast.endedAt, timeZone)).filter((day) => !marked.has(day)),
  );

  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  // Monday-first, which is what most of the world uses and what makes a fasting week read sensibly.
  const leading = (first.getDay() + 6) % 7;

  const cells: (string | null)[] = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(
      `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
    first,
  );
  const today = localDayOf(new Date(), timeZone);

  return (
    <table className="calendar">
      <caption className="calendar__caption">{monthLabel}</caption>
      <thead>
        <tr>
          {/* A single letter on screen, the full name for a screen reader. */}
          {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
            (label) => (
              <th key={label} scope="col" className="calendar__head">
                <span aria-hidden="true">{label.slice(0, 1)}</span>
                <span className="sr-only">{label}</span>
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week.find((day) => day !== null) ?? `empty-${weeks.indexOf(week)}`}>
            {week.map((day, index) =>
              day === null ? (
                <td key={`blank-${index}`} className="calendar__cell calendar__cell--blank" />
              ) : (
                <td
                  key={day}
                  className={[
                    'calendar__cell',
                    marked.has(day) ? 'calendar__cell--met' : '',
                    partial.has(day) ? 'calendar__cell--short' : '',
                    day === today ? 'calendar__cell--today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span aria-hidden="true">{Number(day.slice(-2))}</span>
                  {/*
                    Composed into a single string rather than assembled from several expressions. Separate
                    expressions become separate text nodes, which a screen reader may read with pauses
                    between them and which no single-node text query can match.
                  */}
                  <span className="sr-only">
                    {[
                      String(Number(day.slice(-2))),
                      marked.has(day)
                        ? 'fast completed'
                        : partial.has(day)
                          ? 'fast ended early'
                          : '',
                      day === today ? 'today' : '',
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The month a day string falls in, for the month stepper. */
export function monthOf(day: string): Date {
  const [year, month] = day.split('-').map(Number) as [number, number];
  return new Date(year, month - 1, 1);
}

export { addDays };
