import { useId, useState } from 'react';
import {
  CUSTOM_PLAN_ID,
  CUSTOM_STEP_MINUTES,
  MAX_GOAL_MINUTES,
  MIN_GOAL_MINUTES,
  PLANS,
  formatDuration,
  isValidCustomGoal,
  type FastingPlan,
} from '@fastr/shared';
import { useProfile, useSaveProfile } from '../data/useProfile.js';
import { ExtendedFastNotice } from '../components/ExtendedFastNotice.js';

/**
 * The plan catalog. Requirement 4.
 *
 * Plans come from `packages/shared`, not from a table, so adding one is a pull request with a test rather
 * than a row someone edits at one in the morning.
 *
 * Choosing a plan sets the default for the *next* fast and never touches one in progress (Requirement
 * 4.6), which is enforced simply by writing only to the profile. Nothing here reads or writes `fasts`.
 */
export default function Plans() {
  const profile = useProfile();
  const save = useSaveProfile();

  const [customHours, setCustomHours] = useState<string>('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<FastingPlan | null>(null);

  const selectedId = profile.data?.defaultPlanId;
  const customMinutes = profile.data?.customGoalMinutes ?? null;

  function choose(plan: FastingPlan) {
    // Requirement 4.3 and 17.2. A day or more asks for confirmation before it becomes the default, so
    // nobody starts a 36-hour fast because they tapped a card that looked like the others.
    if (plan.extended) {
      setConfirming(plan);
      return;
    }
    save.mutate({ default_plan_id: plan.id, custom_goal_minutes: null });
  }

  function chooseCustom() {
    setCustomError(null);
    const hours = Number(customHours);

    if (!Number.isFinite(hours) || hours <= 0) {
      setCustomError('Enter a number of hours.');
      return;
    }

    const minutes = Math.round(hours * 60);
    if (!isValidCustomGoal(minutes)) {
      setCustomError(
        `Between ${MIN_GOAL_MINUTES / 60} and ${MAX_GOAL_MINUTES / 60} hours, in steps of ${CUSTOM_STEP_MINUTES} minutes.`,
      );
      return;
    }

    // A custom length of a day or more is still an extended fast, which is why the check is on the goal
    // rather than on the plan.
    if (minutes >= 24 * 60) {
      setConfirming({ ...(PLANS.find((p) => p.custom) as FastingPlan), fastMinutes: minutes });
      return;
    }

    save.mutate({ default_plan_id: CUSTOM_PLAN_ID, custom_goal_minutes: minutes });
  }

  function confirmExtended() {
    if (!confirming) return;
    const isCustom = confirming.custom;
    save.mutate({
      default_plan_id: isCustom ? CUSTOM_PLAN_ID : confirming.id,
      custom_goal_minutes: isCustom ? confirming.fastMinutes : null,
    });
    setConfirming(null);
  }

  return (
    <div className="stack">
      <h1>Plans</h1>
      <p className="muted">
        Pick the one that fits your day. You can change it whenever you like, and changing it never
        affects a fast already running.
      </p>

      {save.isError && (
        <p className="form-error" role="alert">
          That did not save. Check your connection and try again.
        </p>
      )}

      {confirming && (
        <ExtendedFastNotice
          hours={confirming.fastMinutes / 60}
          onConfirm={confirmExtended}
          onCancel={() => setConfirming(null)}
        />
      )}

      <ul className="plans">
        {PLANS.filter((plan) => !plan.custom).map((plan) => (
          <li key={plan.id}>
            <PlanCard plan={plan} selected={selectedId === plan.id} onChoose={choose} />
          </li>
        ))}

        <li>
          <div className={`plan ${selectedId === CUSTOM_PLAN_ID ? 'plan--selected' : ''}`}>
            <span className="plan__head">
              <span className="plan__label">Custom</span>
              {selectedId === CUSTOM_PLAN_ID && customMinutes !== null && (
                <span className="plan__badge">Your plan: {formatDuration(customMinutes)}</span>
              )}
            </span>
            <span className="plan__description">
              Choose your own length, from {MIN_GOAL_MINUTES / 60} to {MAX_GOAL_MINUTES / 60} hours,
              in steps of {CUSTOM_STEP_MINUTES} minutes.
            </span>

            <div className="plan__custom">
              <label className="field__label" htmlFor="custom-hours">
                Hours
              </label>
              <input
                id="custom-hours"
                className="field__input"
                type="number"
                inputMode="decimal"
                min={MIN_GOAL_MINUTES / 60}
                max={MAX_GOAL_MINUTES / 60}
                step={CUSTOM_STEP_MINUTES / 60}
                value={customHours}
                onChange={(event) => setCustomHours(event.target.value)}
              />
              <button type="button" className="button button--secondary" onClick={chooseCustom}>
                Use this
              </button>
            </div>

            {customError && (
              <p className="form-error" role="alert">
                {customError}
              </p>
            )}
          </div>
        </li>
      </ul>
    </div>
  );
}

/**
 * One plan, as a pressable card.
 *
 * A button rather than a radio group: choosing a plan saves immediately, and a radio implies a form with a
 * Save step. `aria-pressed` is what announces which one is current, so the state is not carried by colour.
 *
 * The accessible *name* is the label alone, with the rest attached as a description. Left to default, the
 * name becomes the card's entire text — and since several descriptions mention other plans ("A step up from
 * 12:12"), a screen reader would read a paragraph on focus and the names would not even be unique.
 */
function PlanCard({
  plan,
  selected,
  onChoose,
}: {
  plan: FastingPlan;
  selected: boolean;
  onChoose: (plan: FastingPlan) => void;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;

  return (
    <button
      type="button"
      className={`plan ${selected ? 'plan--selected' : ''}`}
      aria-pressed={selected}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      onClick={() => onChoose(plan)}
    >
      <span className="plan__head">
        <span className="plan__label" id={labelId}>
          {plan.label}
        </span>
        {selected && <span className="plan__badge">Your plan</span>}
      </span>
      <span id={descriptionId}>
        <span className="plan__meta">
          Fast {formatDuration(plan.fastMinutes)}, eat within {formatDuration(plan.eatMinutes)} ·{' '}
          {plan.difficulty}
          {plan.extended && ' · extended fast'}
        </span>
        <span className="plan__description">{plan.description}</span>
      </span>
    </button>
  );
}
