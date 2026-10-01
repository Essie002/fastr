import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  currentStreak,
  displayToGrams,
  formatDuration,
  gramsToDisplay,
  localDayOf,
  longestStreak,
  stats as computeStats,
} from '@fastr/shared';
import { useProfile } from '../data/useProfile.js';
import { useFastHistory } from '../data/useFastHistory.js';
import {
  deleteWeight,
  describeWeightError,
  fetchWeightEntries,
  saveWeight,
  weightQueryKey,
} from '../data/weight.js';
import { WeightChart } from '../components/WeightChart.js';

/** Requirement 11.3. */
const RANGES = [
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: '365', label: '1 year', days: 365 },
  { id: 'all', label: 'All time', days: null },
] as const;

/**
 * Streaks, averages and weight. Requirements 10 and 11.
 *
 * Every number here is derived from the fasts on each render, never stored (Requirement 10.5). That is what
 * makes editing history safe: there is no counter that can disagree with the data it came from.
 *
 * The arithmetic lives in `packages/shared` as pure functions with property tests. This screen only picks the
 * numbers up and lays them out.
 */
export default function Stats() {
  const queryClient = useQueryClient();
  const profile = useProfile();
  const history = useFastHistory();

  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('90');
  const [weightInput, setWeightInput] = useState('');
  const [weightDate, setWeightDate] = useState(() => '');
  const [weightError, setWeightError] = useState<string | null>(null);

  const weights = useQuery({ queryKey: weightQueryKey, queryFn: () => fetchWeightEntries() });

  const save = useMutation({
    mutationFn: saveWeight,
    onSuccess: async () => {
      setWeightInput('');
      setWeightError(null);
      await queryClient.invalidateQueries({ queryKey: weightQueryKey });
    },
    onError: (caught) => setWeightError(describeWeightError(caught)),
  });

  const remove = useMutation({
    mutationFn: deleteWeight,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: weightQueryKey }),
  });

  const timeZone = profile.data?.timeZone ?? 'UTC';
  const unit = profile.data?.weightUnit ?? 'kg';
  const fasts = history.data?.pages.flat() ?? [];

  const selected = RANGES.find((option) => option.id === range) ?? RANGES[1];

  /**
   * The window is measured back from the most recent reading, not from today.
   *
   * Two reasons. Reading the clock during render makes the render impure, which the lint rule objects to for
   * good cause. And it behaves better: someone who logged weights last month and then stopped still sees
   * their chart, where a window anchored to today would show them an empty one.
   */
  const allWeights = weights.data ?? [];
  const newestMs = allWeights.length > 0 ? Date.parse(allWeights.at(-1)!.measuredOn) : 0;
  const shownWeights =
    selected.days === null
      ? allWeights
      : allWeights.filter(
          (entry) => Date.parse(entry.measuredOn) >= newestMs - selected.days * 24 * 60 * 60 * 1000,
        );

  if (history.isLoading || profile.isLoading) {
    return (
      <div className="stack">
        <h1>Stats</h1>
        <p role="status">Loading…</p>
      </div>
    );
  }

  // The streak functions take the clock as a parameter, which is why they are pure and testable. Reading it
  // here, once, keeps that property.
  const nowDate = new Date();
  const current = currentStreak(fasts, timeZone, nowDate);
  const longest = longestStreak(fasts, timeZone);
  const summary = computeStats(fasts, nowDate);

  return (
    <div className="stack">
      <h1>Stats</h1>

      <section className="card stack" aria-labelledby="streaks-heading">
        <h2 id="streaks-heading">Streaks</h2>
        <dl className="figures">
          <Figure label="Current streak" value={`${current} ${current === 1 ? 'day' : 'days'}`} />
          <Figure label="Longest streak" value={`${longest} ${longest === 1 ? 'day' : 'days'}`} />
        </dl>
        <p className="field__hint">
          A day counts when a fast that met its goal ended on it, in your own time zone. Today
          counts as soon as you finish one.
        </p>
      </section>

      <section className="card stack" aria-labelledby="fasting-heading">
        <h2 id="fasting-heading">Fasting</h2>
        <dl className="figures">
          <Figure label="Fasts completed" value={String(summary.totalCompleted)} />
          <Figure
            label="Average, last 7 days"
            value={
              summary.averageMinutesLast7 === null
                ? 'No data yet'
                : formatDuration(summary.averageMinutesLast7)
            }
          />
          <Figure
            label="Average, last 30 days"
            value={
              summary.averageMinutesLast30 === null
                ? 'No data yet'
                : formatDuration(summary.averageMinutesLast30)
            }
          />
          <Figure
            label="Longest fast"
            value={
              summary.longestMinutes === null
                ? 'No data yet'
                : formatDuration(summary.longestMinutes)
            }
          />
          <Figure
            label="Goals met"
            value={
              summary.goalCompletionRate === null
                ? 'No data yet'
                : `${Math.round(summary.goalCompletionRate * 100)}%`
            }
          />
        </dl>
        {history.hasNextPage && (
          <p className="field__hint">
            These cover the fasts loaded so far. Open your history and load older fasts to include
            them.
          </p>
        )}
      </section>

      <section className="card stack" aria-labelledby="weight-heading">
        <h2 id="weight-heading">Weight</h2>

        <div className="segmented" role="group" aria-label="Period to show">
          {RANGES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`segmented__option ${range === option.id ? 'segmented__option--on' : ''}`}
              aria-pressed={range === option.id}
              onClick={() => setRange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {weights.isError ? (
          <p className="form-error" role="alert">
            Your weights could not be loaded.
          </p>
        ) : (
          <WeightChart entries={shownWeights} unit={unit} />
        )}

        <form
          className="weight-form"
          onSubmit={(event) => {
            event.preventDefault();
            setWeightError(null);

            const value = Number(weightInput);
            if (weightInput.trim() === '' || !Number.isFinite(value) || value <= 0) {
              setWeightError('Enter your weight.');
              return;
            }

            save.mutate({
              measuredOn: weightDate === '' ? localDayOf(new Date(), timeZone) : weightDate,
              grams: displayToGrams(value, unit),
            });
          }}
        >
          <div className="field">
            <label className="field__label" htmlFor="weight-value">
              Weight ({unit})
            </label>
            <input
              id="weight-value"
              className="field__input"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={weightInput}
              onChange={(event) => setWeightInput(event.target.value)}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="weight-date">
              Date
            </label>
            <input
              id="weight-date"
              className="field__input"
              type="date"
              value={weightDate}
              onChange={(event) => setWeightDate(event.target.value)}
            />
            <p className="field__hint">Leave blank for today.</p>
          </div>

          <button className="button button--primary" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Log weight'}
          </button>
        </form>

        {weightError && (
          <p className="form-error" role="alert">
            {weightError}
          </p>
        )}

        {shownWeights.length > 0 && (
          <ul className="weight-list">
            {[...shownWeights].reverse().map((entry) => (
              <li key={entry.id}>
                <span>
                  {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(
                    new Date(entry.measuredOn),
                  )}
                </span>
                <span>
                  {gramsToDisplay(entry.grams, unit).toFixed(1)} {unit}
                </span>
                <button
                  type="button"
                  className="button button--link"
                  onClick={() => remove.mutate(entry.id)}
                  // Named, so a screen reader hears which entry is being removed rather than ten identical
                  // "Delete" buttons.
                  aria-label={`Delete the reading from ${entry.measuredOn}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * One figure.
 *
 * A description list, because that is what these are: a term and its value. A grid of divs would need
 * `aria-label` on each to read as a pair.
 */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="figure">
      <dt className="figure__label">{label}</dt>
      <dd className="figure__value">{value}</dd>
    </div>
  );
}
