import { formatWeight, type WeightEntry, type WeightUnit } from '@fastr/shared';

/**
 * Weight over time. Requirements 11.3 and 11.5.
 *
 * A hand-built SVG rather than a charting library. The whole chart is a polyline and some axis labels, which
 * is a few dozen lines here against a dependency whose accessibility would still need the table below anyway.
 *
 * The chart is `aria-hidden` and followed by the same numbers as a real table. Requirement 11.5 asks for a
 * text alternative, and a table is the honest one: a sighted user reads the shape, a screen reader user reads
 * the values, and neither gets a worse version of the other's experience.
 *
 * Nothing here depends on colour. The line carries the data and the table carries it again, so Requirement
 * 19.3 holds without a legend.
 */
export function WeightChart({
  entries,
  unit,
}: {
  entries: readonly WeightEntry[];
  unit: WeightUnit;
}) {
  if (entries.length === 0) {
    return (
      <p className="muted">
        No weights logged for this period. Add one below and it will appear here.
      </p>
    );
  }

  const width = 320;
  const height = 160;
  const padding = { top: 8, right: 8, bottom: 20, left: 8 };

  const values = entries.map((entry) => entry.grams);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero, so give it an arbitrary band and draw the line through the middle.
  const span = max - min === 0 ? 1000 : max - min;

  const times = entries.map((entry) => Date.parse(entry.measuredOn));
  const firstTime = times[0] ?? 0;
  const lastTime = times.at(-1) ?? firstTime;
  const timeSpan = lastTime - firstTime === 0 ? 1 : lastTime - firstTime;

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const points = entries.map((entry, index) => {
    const x = padding.left + ((times[index]! - firstTime) / timeSpan) * plotWidth;
    const y = padding.top + plotHeight - ((entry.grams - min) / span) * plotHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const formatDay = (day: string) =>
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(day));

  const latest = entries.at(-1)!;
  const earliest = entries[0]!;
  const change = latest.grams - earliest.grams;

  return (
    <div className="chart">
      <svg
        className="chart__svg"
        viewBox={`0 0 ${width} ${height}`}
        role="presentation"
        aria-hidden="true"
        focusable="false"
      >
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {entries.length <= 60 &&
          points.map((point, index) => {
            const [x, y] = point.split(',');
            return <circle key={entries[index]!.id} cx={x} cy={y} r={2.5} fill="var(--accent)" />;
          })}
      </svg>

      {/* Stated in words, because the shape of a line is the one thing the table below does not convey. */}
      <p className="chart__summary">
        {formatWeight(latest.grams, unit)} now,{' '}
        {change === 0
          ? 'unchanged over this period'
          : `${change < 0 ? 'down' : 'up'} ${formatWeight(Math.abs(change), unit)} since ${formatDay(earliest.measuredOn)}`}
        .
      </p>

      <details className="chart__data">
        <summary>All {entries.length} readings as a table</summary>
        <table className="data-table">
          <caption className="sr-only">Weight readings, oldest first</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Weight</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <th scope="row">{formatDay(entry.measuredOn)}</th>
                <td>{formatWeight(entry.grams, unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
