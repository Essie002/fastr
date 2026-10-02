import { useId } from 'react';
import type { ActivityScheduleInput } from '@fastr/shared';
import { WEEKDAY_LABELS } from '@fastr/shared';

/**
 * The two schedule shapes, in one form. Requirements 2.1, 3.1, 7.5.
 *
 * A segmented control chooses the shape, and only that shape's fields are rendered. Showing both and disabling
 * one would put controls in the tab order that cannot be used, and would invite the combination the database
 * refuses — a wall-clock time with an interval.
 *
 * The notifications-per-day count under an interval schedule is the cheapest guard in the whole feature. A
 * fifteen-minute interval across sixteen hours is sixty-four notifications a day and a perfectly legal
 * schedule; the honest answer is to show the number before saving rather than impose a limit that would also
 * block someone who meant it.
 */

export interface ScheduleDraft {
  kind: 'at' | 'every';
  localTime: string;
  windowStart: string;
  windowEnd: string;
  intervalMinutes: number;
  weekdays: number[];
}

export const emptySchedule: ScheduleDraft = {
  kind: 'at',
  localTime: '07:00',
  windowStart: '08:00',
  windowEnd: '20:00',
  intervalMinutes: 120,
  // Weekdays rather than every day: the common case for an activity is a working week, and an over-eager
  // default is how someone gets a reminder on a Sunday morning and turns the feature off.
  weekdays: [1, 2, 3, 4, 5],
};

const minutesOfDay = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours! * 60 + minutes!;
};

/** How many times an interval schedule fires on a day it applies to. */
export function occurrencesPerDay(draft: ScheduleDraft): number {
  if (draft.kind === 'at') return 1;
  const span = minutesOfDay(draft.windowEnd) - minutesOfDay(draft.windowStart);
  if (span < 0 || draft.intervalMinutes <= 0) return 0;
  return Math.floor(span / draft.intervalMinutes) + 1;
}

/** What is wrong with this draft, in words the user can act on, or null. */
export function describeScheduleProblem(draft: ScheduleDraft): string | null {
  if (draft.weekdays.length === 0) return 'Pick at least one day.';

  if (draft.kind === 'every') {
    const span = minutesOfDay(draft.windowEnd) - minutesOfDay(draft.windowStart);
    if (span <= 0) return 'The end time has to be after the start time.';
    // Mirrors the `schedule_shape` CHECK. Requirement 3.2.
    if (span < draft.intervalMinutes) {
      return 'That window is shorter than the gap, so it would only ever remind you once.';
    }
  }

  return null;
}

/** The draft as the shape the data layer and the schema both expect. */
export function toScheduleInput(draft: ScheduleDraft): ActivityScheduleInput {
  if (draft.kind === 'at') {
    return {
      kind: 'at',
      localTime: draft.localTime,
      weekdays: draft.weekdays,
      enabled: true,
    };
  }
  return {
    kind: 'every',
    windowStart: draft.windowStart,
    windowEnd: draft.windowEnd,
    intervalMinutes: draft.intervalMinutes,
    weekdays: draft.weekdays,
    enabled: true,
  };
}

const INTERVAL_CHOICES = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: 'Hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
  { minutes: 240, label: '4 hours' },
] as const;

export function ScheduleFields({
  draft,
  onChange,
}: {
  draft: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
}) {
  const id = useId();
  const perDay = occurrencesPerDay(draft);

  const toggleDay = (day: number) =>
    onChange({
      ...draft,
      weekdays: draft.weekdays.includes(day)
        ? draft.weekdays.filter((value) => value !== day)
        : [...draft.weekdays, day].sort((a, b) => a - b),
    });

  return (
    <>
      <fieldset className="fieldset">
        <legend className="field__label">When</legend>
        {/*
          A radio group rather than a segmented control of buttons: this chooses between two mutually
          exclusive modes, which is what radios mean, and it gets arrow-key navigation for free.
        */}
        <div className="segmented" role="radiogroup" aria-label="Schedule type">
          <label
            className={`segmented__option ${draft.kind === 'at' ? 'segmented__option--on' : ''}`}
          >
            <input
              type="radio"
              className="sr-only"
              name={`${id}-kind`}
              checked={draft.kind === 'at'}
              onChange={() => onChange({ ...draft, kind: 'at' })}
            />
            At a time
          </label>
          <label
            className={`segmented__option ${draft.kind === 'every' ? 'segmented__option--on' : ''}`}
          >
            <input
              type="radio"
              className="sr-only"
              name={`${id}-kind`}
              checked={draft.kind === 'every'}
              onChange={() => onChange({ ...draft, kind: 'every' })}
            />
            Repeatedly
          </label>
        </div>
      </fieldset>

      {draft.kind === 'at' ? (
        <div className="field">
          <label className="field__label" htmlFor={`${id}-time`}>
            Time
          </label>
          <input
            id={`${id}-time`}
            className="field__input"
            type="time"
            value={draft.localTime}
            onChange={(event) => onChange({ ...draft, localTime: event.target.value })}
            required
          />
        </div>
      ) : (
        <>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-interval`}>
              How often
            </label>
            <select
              id={`${id}-interval`}
              className="field__input"
              value={draft.intervalMinutes}
              onChange={(event) =>
                onChange({ ...draft, intervalMinutes: Number(event.target.value) })
              }
            >
              {INTERVAL_CHOICES.map((choice) => (
                <option key={choice.minutes} value={choice.minutes}>
                  Every {choice.label.toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="timer__backdate">
            <div className="field">
              <label className="field__label" htmlFor={`${id}-from`}>
                From
              </label>
              <input
                id={`${id}-from`}
                className="field__input"
                type="time"
                value={draft.windowStart}
                onChange={(event) => onChange({ ...draft, windowStart: event.target.value })}
                required
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor={`${id}-until`}>
                Until
              </label>
              <input
                id={`${id}-until`}
                className="field__input"
                type="time"
                value={draft.windowEnd}
                onChange={(event) => onChange({ ...draft, windowEnd: event.target.value })}
                required
              />
            </div>
          </div>

          {perDay > 0 && (
            // Stated before saving, not after. Sixty-four notifications a day is a legal schedule and
            // somebody's mistake; the number is the warning.
            <p className="field__hint" id={`${id}-count`}>
              {perDay === 1
                ? 'That would remind you once a day.'
                : `That would remind you ${perDay} times a day.`}
            </p>
          )}
        </>
      )}

      <fieldset className="fieldset">
        <legend className="field__label">Days</legend>
        <div className="reminders__days">
          {WEEKDAY_LABELS.map((day) => (
            <label key={day.value} className="reminders__day">
              <input
                type="checkbox"
                checked={draft.weekdays.includes(day.value)}
                onChange={() => toggleDay(day.value)}
              />
              {/* The letter alone is ambiguous — two Ts and two Ss — so the full name carries the meaning
                  for assistive technology and the letter is decoration. Requirement 10.2. */}
              <span className="sr-only">{day.long}</span>
              <span aria-hidden="true">{day.short}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
