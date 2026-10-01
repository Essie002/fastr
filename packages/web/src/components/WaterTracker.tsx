import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { flOzToMl, formatVolume, type VolumeUnit, type TimeZone } from '@fastr/shared';
import { useState } from 'react';
import {
  addWater,
  deleteWater,
  fetchRecentWater,
  todaysEntries,
  totalMl,
  waterQueryKey,
} from '../data/water.js';

/**
 * Water for today. Requirement 12.
 *
 * Quick-add buttons rather than a number field, because this is the one thing in Fastr someone does six times
 * a day and typing "250" six times is six times too many. The custom amount is there for a bottle of an
 * unusual size.
 *
 * The quick amounts are expressed in the user's own unit: offering "+250 ml" to someone working in fluid
 * ounces is asking them to do arithmetic to log a glass of water.
 */

const QUICK_ML = [250, 500];
const QUICK_FLOZ = [8, 16];

export function WaterTracker({
  timeZone,
  unit,
  goalMl,
}: {
  timeZone: TimeZone;
  unit: VolumeUnit;
  goalMl: number;
}) {
  const queryClient = useQueryClient();
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);

  const water = useQuery({ queryKey: waterQueryKey, queryFn: fetchRecentWater });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: waterQueryKey });

  const add = useMutation({
    mutationFn: (ml: number) => addWater(ml),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: () => setError('That did not save. Check your connection and try again.'),
  });

  const remove = useMutation({
    mutationFn: deleteWater,
    onSuccess: invalidate,
    onError: () => setError('That did not save. Check your connection and try again.'),
  });

  // Read on render rather than ticked: the day boundary matters, and being a few seconds stale across
  // midnight is not worth an interval on this screen.
  const today = todaysEntries(water.data ?? [], timeZone, new Date());
  const total = totalMl(today);
  const fraction = goalMl > 0 ? Math.min(1, total / goalMl) : 0;
  const quick = unit === 'ml' ? QUICK_ML : QUICK_FLOZ.map((value) => flOzToMl(value));

  return (
    <section className="card stack water" aria-labelledby="water-heading">
      <h2 id="water-heading">Water today</h2>

      {/*
        A progress bar with its value as text beside it. `role="progressbar"` carries the number for assistive
        technology, and the visible text carries it for everyone else, so nothing depends on the width of a
        bar being judged by eye.
      */}
      <div
        className="water__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={goalMl}
        aria-valuenow={total}
        aria-valuetext={`${formatVolume(total, unit)} of ${formatVolume(goalMl, unit)}`}
      >
        <div className="water__fill" style={{ inlineSize: `${fraction * 100}%` }} />
      </div>

      <p className="water__total">
        {formatVolume(total, unit)} of {formatVolume(goalMl, unit)}
        {total >= goalMl && ' — goal reached'}
      </p>

      <div className="water__quick">
        {quick.map((ml) => (
          <button
            key={ml}
            type="button"
            className="button button--secondary"
            disabled={add.isPending}
            onClick={() => add.mutate(ml)}
          >
            + {formatVolume(ml, unit)}
          </button>
        ))}
      </div>

      <form
        className="water__custom"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);

          const value = Number(custom);
          if (custom.trim() === '' || !Number.isFinite(value) || value <= 0) {
            setError('Enter an amount.');
            return;
          }

          const ml = unit === 'ml' ? Math.round(value) : flOzToMl(value);
          if (ml > 5000) {
            // The database caps a single entry at five litres, so this is caught before the round trip.
            setError('That is more than one entry can hold. Log it in a couple of goes.');
            return;
          }

          add.mutate(ml, { onSuccess: () => setCustom('') });
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="water-custom">
            Another amount ({unit === 'ml' ? 'ml' : 'fl oz'})
          </label>
          <input
            id="water-custom"
            className="field__input"
            type="number"
            inputMode="decimal"
            min={1}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
        </div>
        <button className="button button--secondary" type="submit" disabled={add.isPending}>
          Add
        </button>
      </form>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {today.length > 0 && (
        <>
          {/* Requirement 12.3. The last entry is the one people need to take back, so it gets its own button. */}
          <button
            type="button"
            className="button button--link"
            disabled={remove.isPending}
            onClick={() => remove.mutate(today[0]!.id)}
          >
            Undo {formatVolume(today[0]!.ml, unit)}
          </button>

          <details>
            <summary className="water__summary">Today&apos;s {today.length} entries</summary>
            <ul className="water__list">
              {today.map((entry) => (
                <li key={entry.id}>
                  <span>
                    {new Intl.DateTimeFormat('en-GB', {
                      timeZone,
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    }).format(new Date(entry.loggedAt))}
                  </span>
                  <span>{formatVolume(entry.ml, unit)}</span>
                  <button
                    type="button"
                    className="button button--link"
                    onClick={() => remove.mutate(entry.id)}
                    aria-label={`Delete ${formatVolume(entry.ml, unit)} logged at ${new Intl.DateTimeFormat(
                      'en-GB',
                      { timeZone, hour: '2-digit', minute: '2-digit', hour12: false },
                    ).format(new Date(entry.loggedAt))}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
