import { useState } from 'react';
import {
  actualMinutes,
  findPlan,
  formatDuration,
  localDayOf,
  metGoal,
  type CompletedFast,
} from '@fastr/shared';
import { useProfile } from '../data/useProfile.js';
import {
  useAddPastFast,
  useDeleteFast,
  useEditFast,
  useFastHistory,
} from '../data/useFastHistory.js';
import { describeFastError } from '../data/fasts.js';
import { FastCalendar } from '../components/FastCalendar.js';
import { EditFastForm } from '../components/EditFastForm.js';
import { AddPastFastForm } from '../components/AddPastFastForm.js';

/**
 * History. Requirement 9.
 *
 * A list and a calendar over the same data, switched rather than shown together: on a phone the two stacked
 * would mean scrolling past a month grid to reach the list.
 *
 * The calendar only ever marks days from pages already loaded, which is why the month stepper is bounded by
 * what has been fetched rather than letting someone page back to 2019 and see an empty grid that looks like
 * lost data.
 */
export default function History() {
  const profile = useProfile();
  const history = useFastHistory();
  const edit = useEditFast();
  const remove = useDeleteFast();
  const add = useAddPastFast();

  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [editing, setEditing] = useState<CompletedFast | null>(null);
  const [adding, setAdding] = useState(false);
  // Opened on the month of the most recent fast rather than on today's.
  //
  // Those are usually the same month, and when they are not, defaulting to today shows an empty grid to
  // someone who has months of history — which looks like lost data rather than like the wrong month. Null
  // until the first page arrives, so the initial value is taken once there is something to take it from.
  const [month, setMonth] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const timeZone = profile.data?.timeZone ?? 'UTC';
  const fasts = history.data?.pages.flat() ?? [];

  // History is newest first, so the first row is the most recent.
  //
  // No `new Date()` fallback: parsing a stored instant is pure, reading the clock during render is not, and
  // the calendar is only reachable when there is at least one fast — so there is always something to take
  // the month from.
  const latest = fasts[0];
  const shownMonth = month ?? (latest ? new Date(latest.endedAt) : null);

  if (history.isLoading) {
    return (
      <div className="stack">
        <h1>History</h1>
        <p role="status">Loading your fasts…</p>
      </div>
    );
  }

  if (history.isError) {
    return (
      <div className="stack">
        <h1>History</h1>
        <p className="form-error" role="alert">
          Your history could not be loaded. Check your connection and reload.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>History</h1>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="segmented" role="group" aria-label="How to show your history">
        <button
          type="button"
          className={`segmented__option ${view === 'list' ? 'segmented__option--on' : ''}`}
          aria-pressed={view === 'list'}
          onClick={() => setView('list')}
        >
          List
        </button>
        <button
          type="button"
          className={`segmented__option ${view === 'calendar' ? 'segmented__option--on' : ''}`}
          aria-pressed={view === 'calendar'}
          onClick={() => setView('calendar')}
        >
          Calendar
        </button>
      </div>

      {adding ? (
        <AddPastFastForm
          defaultPlanId={profile.data?.defaultPlanId ?? '16:8'}
          customGoalMinutes={profile.data?.customGoalMinutes ?? null}
          busy={add.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={(input) => {
            setError(null);
            add.mutate(input, {
              onSuccess: () => setAdding(false),
              onError: (caught) => setError(describeFastError(caught)),
            });
          }}
        />
      ) : (
        <button type="button" className="button button--secondary" onClick={() => setAdding(true)}>
          Add a fast you did not track
        </button>
      )}

      {editing && (
        <EditFastForm
          fast={editing}
          timeZone={timeZone}
          busy={edit.isPending}
          onCancel={() => setEditing(null)}
          onDelete={() => {
            setError(null);
            remove.mutate(editing.id, {
              onSuccess: () => setEditing(null),
              onError: (caught) => setError(describeFastError(caught)),
            });
          }}
          onSubmit={(input) => {
            setError(null);
            edit.mutate(
              { id: editing.id, ...input },
              {
                onSuccess: () => setEditing(null),
                onError: (caught) => setError(describeFastError(caught)),
              },
            );
          }}
        />
      )}

      {fasts.length === 0 ? (
        <div className="card">
          <p className="muted">
            No finished fasts yet. Start one from the timer, or add one you did not track.
          </p>
        </div>
      ) : view === 'calendar' && shownMonth ? (
        <div className="stack">
          <div className="calendar__nav">
            <button
              type="button"
              className="button button--secondary"
              onClick={() =>
                setMonth(new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1))
              }
            >
              Previous month
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() =>
                setMonth(new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1))
              }
            >
              Next month
            </button>
          </div>

          <FastCalendar fasts={fasts} timeZone={timeZone} month={shownMonth} />

          <p className="muted calendar__key">
            A filled day means a fast that met its goal. An outlined day means one that ended early.
          </p>
        </div>
      ) : (
        <ul className="history">
          {fasts.map((fast) => (
            <li key={fast.id}>
              <button
                type="button"
                className="history__item"
                onClick={() => setEditing(fast)}
                aria-label={`${localDayOf(fast.endedAt, timeZone)}, ${formatDuration(actualMinutes(fast))}, ${
                  metGoal(fast) ? 'goal met' : 'ended early'
                }. Edit`}
              >
                <span className="history__day" aria-hidden="true">
                  {new Intl.DateTimeFormat('en-GB', {
                    timeZone,
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  }).format(new Date(fast.endedAt))}
                </span>
                <span className="history__duration" aria-hidden="true">
                  {formatDuration(actualMinutes(fast))}
                </span>
                <span className="history__meta" aria-hidden="true">
                  {findPlan(fast.planId)?.label ?? fast.planId} · goal{' '}
                  {formatDuration(fast.goalMinutes)} · {metGoal(fast) ? 'met' : 'ended early'}
                  {fast.mood !== null && ` · mood ${fast.mood}/5`}
                  {fast.energy !== null && ` · energy ${fast.energy}/5`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {history.hasNextPage && (
        <button
          type="button"
          className="button button--secondary"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? 'Loading…' : 'Load older fasts'}
        </button>
      )}
    </div>
  );
}
