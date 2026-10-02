import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  activityIcon,
  activityStreak,
  activityTotals,
  formatDuration,
  groupByLocalDay,
} from '@fastr/shared';
import { activityLogQueryKey, deleteCompletion, fetchActivityLog } from '../data/activityLog.js';

/**
 * What you actually did. Requirement 6.
 *
 * Computed from completions, never from reminders sent. The user already knows what Fastr suggested — they were
 * there when it buzzed. What they do not know is what they did, which is the only thing worth counting.
 */
export function ActivityHistory({ timeZone }: { timeZone: string }) {
  const queryClient = useQueryClient();
  const log = useQuery({ queryKey: activityLogQueryKey, queryFn: () => fetchActivityLog() });

  const remove = useMutation({
    mutationFn: deleteCompletion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: activityLogQueryKey }),
  });

  const completions = log.data ?? [];
  const now = new Date();

  if (log.isPending) {
    return (
      <section className="card stack" aria-labelledby="activity-history-heading">
        <h2 id="activity-history-heading">What you did</h2>
        <p role="status">Loading…</p>
      </section>
    );
  }

  if (completions.length === 0) {
    return (
      <section className="card stack" aria-labelledby="activity-history-heading">
        <h2 id="activity-history-heading">What you did</h2>
        {/* Requirement 6.5. Says so plainly rather than rendering an empty chart. */}
        <p className="muted">
          Nothing logged yet. Tap &ldquo;Log it&rdquo; after an activity and it will show up here.
        </p>
      </section>
    );
  }

  const totals = activityTotals(completions, now);
  const streak = activityStreak(completions, timeZone, now);
  const days = groupByLocalDay(completions, timeZone);

  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    }).format(new Date(`${day}T12:00:00Z`));

  return (
    <section className="card stack" aria-labelledby="activity-history-heading">
      <h2 id="activity-history-heading">What you did</h2>

      {/* `dl`/`dt`/`dd` to match the Stats screen. Two spans render inline, which is how the label and the
          number ended up as "Current streak2 days" the first time this was looked at in a browser. */}
      <dl className="figures">
        <div className="figure">
          <dt className="figure__label">Current streak</dt>
          <dd className="figure__value">
            {streak} {streak === 1 ? 'day' : 'days'}
          </dd>
        </div>
      </dl>
      <p className="field__hint">
        A day counts when you logged at least one activity, in your own time zone. Today counts as
        soon as you log something.
      </p>

      <h3>Per activity</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Activity</th>
            <th scope="col">7 days</th>
            <th scope="col">30 days</th>
            <th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          {totals.map((total) => (
            <tr key={total.label}>
              <th scope="row">
                <span aria-hidden="true">{activityIcon(total.typeKey)}</span> {total.label}
              </th>
              <td>{total.last7}</td>
              <td>{total.last30}</td>
              <td>{total.totalMinutes > 0 ? formatDuration(total.totalMinutes) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Recently</h3>
      {days.map((group) => (
        <div key={group.day}>
          <h4 className="history__day">{dayLabel(group.day)}</h4>
          <ul className="history">
            {group.items.map((item) => (
              <li key={item.id} className="row">
                <span>
                  <span aria-hidden="true">{activityIcon(item.typeKey)}</span> {item.label}
                </span>
                {item.minutes !== null && (
                  <span className="muted">{formatDuration(item.minutes)}</span>
                )}
                <button
                  className="button button--link"
                  type="button"
                  onClick={() => remove.mutate(item.id)}
                  aria-label={`Delete the ${item.label} on ${dayLabel(group.day)}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
