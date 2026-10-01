import { useState } from 'react';
import { PLANS, findPlan, formatDuration, goalMinutesFor } from '@fastr/shared';
import { toLocalInput } from './EditFastForm.js';
import { validateFastTimes } from '../time/validateFastTimes.js';

/**
 * Logging a fast that was never tracked. Requirement 9.4.
 *
 * Defaults to yesterday evening through this morning, because that is the shape of almost every untracked
 * fast: someone remembers after the fact that they skipped breakfast.
 *
 * The goal comes from the plan chosen here rather than from the profile's current default, so logging an old
 * 18:6 fast does not record it against today's 16:8 goal and read as having overshot.
 */
export function AddPastFastForm({
  defaultPlanId,
  customGoalMinutes,
  busy,
  onSubmit,
  onCancel,
}: {
  defaultPlanId: string;
  customGoalMinutes: number | null;
  busy: boolean;
  onSubmit: (input: {
    planId: string;
    goalMinutes: number;
    startAt: string;
    endedAt: string;
  }) => void;
  onCancel: () => void;
}) {
  const [planId, setPlanId] = useState(defaultPlanId);
  const [startAt, setStartAt] = useState(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(20, 0, 0, 0);
    return toLocalInput(yesterday.toISOString());
  });
  const [endedAt, setEndedAt] = useState(() => {
    const noonToday = new Date();
    noonToday.setHours(12, 0, 0, 0);
    // Never later than now. Opening this form before midday would otherwise pre-fill an end time in the
    // future, so the first thing the user sees on pressing Add is an error about a form they did not fill in.
    const end = noonToday.getTime() > Date.now() ? new Date() : noonToday;
    return toLocalInput(end.toISOString());
  });
  const [problem, setProblem] = useState<string | null>(null);

  const plan = findPlan(planId);
  const goalMinutes = plan ? goalMinutesFor(plan, customGoalMinutes ?? 960) : 960;

  const start = Date.parse(startAt);
  const end = Date.parse(endedAt);
  const preview =
    Number.isNaN(start) || Number.isNaN(end) || end <= start
      ? null
      : formatDuration((end - start) / 60_000);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);

    const checked = validateFastTimes(startAt, endedAt);
    if (!checked.ok) {
      setProblem(checked.problem);
      return;
    }

    onSubmit({
      planId,
      goalMinutes,
      startAt: new Date(checked.times.startMs).toISOString(),
      endedAt: new Date(checked.times.endMs).toISOString(),
    });
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-labelledby="add-fast-heading">
      <h2 id="add-fast-heading">Add a past fast</h2>

      <div className="field">
        <label className="field__label" htmlFor="add-plan">
          Plan
        </label>
        <select
          id="add-plan"
          className="field__input"
          value={planId}
          disabled={busy}
          onChange={(event) => setPlanId(event.target.value)}
        >
          {PLANS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="add-start">
          Started
        </label>
        <input
          id="add-start"
          className="field__input"
          type="datetime-local"
          value={startAt}
          disabled={busy}
          onChange={(event) => setStartAt(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="add-end">
          Ended
        </label>
        <input
          id="add-end"
          className="field__input"
          type="datetime-local"
          value={endedAt}
          disabled={busy}
          onChange={(event) => setEndedAt(event.target.value)}
        />
      </div>

      {preview && (
        <p className="muted" role="status">
          That is {preview}, against a goal of {formatDuration(goalMinutes)}.
        </p>
      )}

      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}

      <div className="notice__actions">
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Add fast'}
        </button>
        <button
          className="button button--secondary"
          type="button"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
