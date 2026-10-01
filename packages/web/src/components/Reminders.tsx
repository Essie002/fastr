import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WEEKDAY_LABELS,
  createReminder,
  deleteReminder,
  describeWeekdays,
  fetchReminders,
  remindersQueryKey,
  updateReminder,
} from '../data/reminders.js';

/**
 * Reminders to start a fast. Requirement 8.
 *
 * Several are allowed rather than one, because a single reminder cannot express "8pm on weekdays, 10pm at the
 * weekend", and that is a normal shape for someone's week.
 */
export function Reminders({ timeZone }: { timeZone: string }) {
  const queryClient = useQueryClient();
  const reminders = useQuery({ queryKey: remindersQueryKey, queryFn: fetchReminders });

  const [time, setTime] = useState('20:00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: remindersQueryKey });

  const create = useMutation({
    mutationFn: createReminder,
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: () => setError('That did not save. Check your connection and try again.'),
  });

  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; enabled?: boolean }) => updateReminder(id, patch),
    onSuccess: invalidate,
  });

  const remove = useMutation({ mutationFn: deleteReminder, onSuccess: invalidate });

  return (
    <section className="card stack" aria-labelledby="reminders-heading">
      <h2 id="reminders-heading">Reminders</h2>
      <p className="field__hint">
        A nudge to start your fast. Skipped automatically when a fast is already running. Times are
        in {timeZone}.
      </p>

      {(reminders.data?.length ?? 0) > 0 && (
        <ul className="reminders">
          {reminders.data!.map((reminder) => (
            <li key={reminder.id}>
              <span className="reminders__time">{reminder.localTime}</span>
              <span className="muted">{describeWeekdays(reminder.weekdays)}</span>

              <label className="reminders__toggle">
                <input
                  type="checkbox"
                  checked={reminder.enabled}
                  onChange={(event) =>
                    update.mutate({ id: reminder.id, enabled: event.target.checked })
                  }
                />
                {/* Named per reminder, so a screen reader hears which one is being switched. */}
                <span className="sr-only">
                  {`Enable the ${reminder.localTime} reminder on ${describeWeekdays(reminder.weekdays)}`}
                </span>
                <span aria-hidden="true">{reminder.enabled ? 'On' : 'Off'}</span>
              </label>

              <button
                type="button"
                className="button button--link"
                onClick={() => remove.mutate(reminder.id)}
                aria-label={`Delete the ${reminder.localTime} reminder`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);

          if (days.length === 0) {
            // The database refuses an empty weekday array; catching it here gives a message about the rule.
            setError('Pick at least one day.');
            return;
          }

          create.mutate({ localTime: time, weekdays: days });
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="reminder-time">
            Time
          </label>
          <input
            id="reminder-time"
            className="field__input"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </div>

        <fieldset className="scale">
          <legend className="field__label">Days</legend>
          <div className="reminders__days">
            {WEEKDAY_LABELS.map((day) => (
              <label className="reminders__day" key={day.value}>
                <input
                  type="checkbox"
                  checked={days.includes(day.value)}
                  onChange={(event) =>
                    setDays((current) =>
                      event.target.checked
                        ? [...current, day.value]
                        : current.filter((value) => value !== day.value),
                    )
                  }
                />
                {/* Saturday and Sunday both read "S" on screen, so the full name carries the meaning. */}
                <span aria-hidden="true">{day.short}</span>
                <span className="sr-only">{day.long}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button className="button button--secondary" type="submit" disabled={create.isPending}>
          {create.isPending ? 'Adding…' : 'Add reminder'}
        </button>
      </form>
    </section>
  );
}
