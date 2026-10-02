import { useId, useState } from 'react';
import { ACTIVITY_TYPES, findActivityType } from '@fastr/shared';
import {
  ScheduleFields,
  describeScheduleProblem,
  emptySchedule,
  toScheduleInput,
  type ScheduleDraft,
} from './ScheduleFields.js';
import type { ActivityScheduleInput } from '@fastr/shared';

/**
 * Adding an activity. Requirements 1.3, 1.4, 1.5, 4.3, 7.5.
 *
 * One form creates the activity and its first schedule together. Splitting them would leave an activity with no
 * schedule after the first step, which is an activity that never does anything — and the user would have no way
 * to know that was a half-finished state rather than a broken feature.
 *
 * The custom option is a value in the same picker rather than a separate mode, so "something else" sits beside
 * the presets where someone looking for their own activity will actually find it.
 */

const CUSTOM = '__custom__';

export interface ActivityDraft {
  typeKey: string | null;
  customLabel: string | null;
  durationMinutes: number;
  notifyEnd: boolean;
  schedule: ActivityScheduleInput;
}

export function ActivityForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (draft: ActivityDraft) => void;
  onCancel: () => void;
}) {
  const id = useId();

  const [choice, setChoice] = useState<string>('walk');
  const [customLabel, setCustomLabel] = useState('');
  const [duration, setDuration] = useState(findActivityType('walk')!.defaultMinutes);
  const [notifyEnd, setNotifyEnd] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleDraft>(emptySchedule);
  const [error, setError] = useState<string | null>(null);

  const isCustom = choice === CUSTOM;
  const type = isCustom ? undefined : findActivityType(choice);
  // Water is measured in volume, so a duration field for it would be asking the wrong question.
  const isVolume = type?.unit === 'ml';

  function pickType(next: string) {
    setChoice(next);
    const preset = findActivityType(next);
    // Follows the preset's default, because a 45-minute default left over from "swim" is wrong for "stretch"
    // and the user would have to notice and fix it.
    if (preset) setDuration(preset.defaultMinutes);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();

    const label = customLabel.trim();
    if (isCustom && (label.length < 1 || label.length > 40)) {
      setError('Give your activity a name, up to 40 characters.');
      return;
    }

    const scheduleProblem = describeScheduleProblem(schedule);
    if (scheduleProblem) {
      setError(scheduleProblem);
      return;
    }

    setError(null);
    onSubmit({
      typeKey: isCustom ? null : choice,
      customLabel: isCustom ? label : null,
      // The database requires a positive duration even for water, where it means nothing. One is the
      // smallest honest value rather than a number that looks like a real duration.
      durationMinutes: isVolume ? 1 : duration,
      notifyEnd: isVolume ? false : notifyEnd,
      schedule: toScheduleInput(schedule),
    });
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <h2>Add an activity</h2>

      <div className="field">
        <label className="field__label" htmlFor={`${id}-type`}>
          What
        </label>
        <select
          id={`${id}-type`}
          className="field__input"
          value={choice}
          onChange={(event) => pickType(event.target.value)}
        >
          {ACTIVITY_TYPES.map((activityType) => (
            <option key={activityType.key} value={activityType.key}>
              {activityType.icon} {activityType.label}
            </option>
          ))}
          <option value={CUSTOM}>Something else</option>
        </select>
      </div>

      {isCustom && (
        <div className="field">
          <label className="field__label" htmlFor={`${id}-label`}>
            Name it
          </label>
          <input
            id={`${id}-label`}
            className="field__input"
            type="text"
            maxLength={40}
            value={customLabel}
            onChange={(event) => setCustomLabel(event.target.value)}
            aria-describedby={`${id}-label-hint`}
            required
          />
          <p className="field__hint" id={`${id}-label-hint`}>
            Fastr will use this word in the reminder.
          </p>
        </div>
      )}

      {!isVolume && (
        <div className="field">
          <label className="field__label" htmlFor={`${id}-duration`}>
            How long
          </label>
          <input
            id={`${id}-duration`}
            className="field__input"
            type="number"
            min={1}
            max={480}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            aria-describedby={`${id}-duration-hint`}
            required
          />
          <p className="field__hint" id={`${id}-duration-hint`}>
            Minutes. Shown in the reminder so you know what you signed up for.
          </p>
        </div>
      )}

      <ScheduleFields draft={schedule} onChange={setSchedule} />

      {!isVolume && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={notifyEnd}
            onChange={(event) => setNotifyEnd(event.target.checked)}
          />
          <span>Also remind me when it should be finished</span>
        </label>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button className="button button--primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Add activity'}
      </button>
      <button className="button button--link" type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
