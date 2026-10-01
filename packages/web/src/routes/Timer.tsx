import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  findPlan,
  formatDuration,
  goalMinutesFor,
  isExtendedGoal,
  minutesBetween,
  stageAt,
} from '@fastr/shared';
import type { Fast } from '@fastr/shared';
import {
  activeFastQueryKey,
  cancelFast,
  describeFastError,
  endFast,
  fastHistoryQueryKey,
  fetchActiveFast,
  startFast,
} from '../data/fasts.js';
import { useProfile } from '../data/useProfile.js';
import { useTick } from '../hooks/useTick.js';
import { useOnline } from '../hooks/useOnline.js';
import { now } from '../time/clock.js';
import { TimerDisplay } from '../components/TimerDisplay.js';
import { ExtendedFastNotice } from '../components/ExtendedFastNotice.js';
import { StageAnnouncer } from '../components/StageAnnouncer.js';
import { MoodPicker } from '../components/MoodPicker.js';
import { WaterTracker } from '../components/WaterTracker.js';

/**
 * The home screen. Requirements 5 and 6.
 *
 * The one rule this screen is built around: the only stored value is `start_at`, and elapsed time is always
 * `now - start_at`, recomputed. Nothing is accumulated. That is what makes the timer correct after a reload,
 * after a phone sleeps, and on a second device at the same moment.
 */
export default function Timer() {
  const queryClient = useQueryClient();
  const profile = useProfile();

  const active = useQuery({ queryKey: activeFastQueryKey, queryFn: fetchActiveFast });

  // Only ticks while something is running. A screen with no fast has nothing to recompute.
  const time = useTick(active.data != null);

  // Requirement 15.4. Writes are disabled offline rather than queued: a fast that silently starts when the
  // network returns, hours later, with a start time from when the button was pressed, is worse than a button
  // that says it cannot be used yet. The timer itself keeps running from the cached start.
  const online = useOnline();

  const [error, setError] = useState<string | null>(null);
  const [confirmingExtended, setConfirmingExtended] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [backdating, setBackdating] = useState(false);
  const [backdateHours, setBackdateHours] = useState('');

  // The optional reflection shown while ending a fast. Requirement 13.2.
  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: activeFastQueryKey }),
      queryClient.invalidateQueries({ queryKey: fastHistoryQueryKey }),
    ]);

  const begin = useMutation({
    mutationFn: startFast,
    onSuccess: async () => {
      setError(null);
      setBackdating(false);
      setBackdateHours('');
      await invalidate();
    },
    onError: (caught) => setError(describeFastError(caught)),
  });

  const finish = useMutation({
    mutationFn: endFast,
    onSuccess: async () => {
      setError(null);
      setConfirmingEnd(false);
      await invalidate();
    },
    onError: (caught) => setError(describeFastError(caught)),
  });

  const discard = useMutation({
    mutationFn: cancelFast,
    onSuccess: async () => {
      setError(null);
      setConfirmingCancel(false);
      await invalidate();
    },
    onError: (caught) => setError(describeFastError(caught)),
  });

  const plan = profile.data ? findPlan(profile.data.defaultPlanId) : undefined;
  const goalMinutes =
    plan && profile.data ? goalMinutesFor(plan, profile.data.customGoalMinutes) : 960;

  function requestStart() {
    setError(null);

    const hours = backdating ? Number(backdateHours) : 0;
    if (backdating) {
      // The emptiness check is separate from the numeric one, because a number input discards characters
      // it cannot use: typing "-" leaves the field empty, `Number('')` is 0, and the fast would quietly
      // start now instead of reporting that nothing was entered.
      if (backdateHours.trim() === '' || !Number.isFinite(hours) || hours <= 0) {
        setError('Enter how many hours ago you started.');
        return;
      }
      // Requirement 5.3. Checked here so the message is about the rule rather than about a trigger.
      if (hours > 48) {
        setError('A fast you are starting now cannot have begun more than 48 hours ago.');
        return;
      }
    }

    // Requirement 17.2. A fast of a day or more is confirmed before it starts, not only when the plan was
    // chosen: the plan may have been picked weeks ago.
    if (isExtendedGoal(goalMinutes)) {
      setConfirmingExtended(true);
      return;
    }

    doStart(hours);
  }

  function doStart(hoursAgo: number) {
    if (!plan) return;
    setConfirmingExtended(false);
    begin.mutate({
      planId: plan.id,
      goalMinutes,
      ...(hoursAgo > 0 ? { startAt: new Date(now() - hoursAgo * 3_600_000).toISOString() } : {}),
    });
  }

  if (profile.isLoading || active.isLoading) {
    return (
      <div className="stack">
        <h1>Timer</h1>
        <p role="status">Loading…</p>
      </div>
    );
  }

  const fast = active.data ?? null;
  const elapsedMinutes = fast ? Math.max(0, minutesBetween(fast.startAt, new Date(time))) : 0;
  const metGoal = fast ? elapsedMinutes >= fast.goalMinutes : false;

  return (
    <div className="stack">
      {/* Visually the ring is the heading, but a page still needs one. */}
      <h1 className="sr-only">Timer</h1>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {fast ? (
        <>
          <StageAnnouncer elapsedMinutes={elapsedMinutes} goalMinutes={fast.goalMinutes} />

          <TimerDisplay
            fast={fast}
            elapsedMinutes={elapsedMinutes}
            timeZone={profile.data?.timeZone ?? 'UTC'}
          />

          {/* Requirement 17.4. */}
          {elapsedMinutes >= 72 * 60 && (
            <div className="notice notice--danger" role="alert">
              <h2>You have been fasting for over three days</h2>
              <p>
                This is far beyond what Fastr is built for. Please end this fast and speak to a
                doctor.
              </p>
            </div>
          )}

          {confirmingEnd ? (
            <div className="card stack" role="alertdialog" aria-labelledby="end-heading">
              <h2 id="end-heading">End this fast?</h2>
              <p className="muted">
                {metGoal
                  ? `You reached your goal. This will be recorded as ${formatDuration(elapsedMinutes)}.`
                  : `You are ${formatDuration(fast.goalMinutes - elapsedMinutes)} short of your goal, so this will be recorded as ended early.`}
              </p>

              {/*
                Requirement 13.2. Offered, and skippable: the buttons below work whether or not anything here
                is filled in, so ending a fast never requires answering a question first.
              */}
              <details className="end-reflection">
                <summary>How did it go? (optional)</summary>
                <div className="stack">
                  <MoodPicker
                    mood={mood}
                    energy={energy}
                    note={note}
                    onMoodChange={setMood}
                    onEnergyChange={setEnergy}
                    onNoteChange={setNote}
                    disabled={finish.isPending}
                  />
                </div>
              </details>

              <div className="notice__actions">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={finish.isPending}
                  onClick={() =>
                    finish.mutate({
                      id: fast.id,
                      metGoal,
                      mood,
                      energy,
                      note: note.trim() === '' ? null : note.trim(),
                    })
                  }
                >
                  {finish.isPending ? 'Ending…' : 'End fast'}
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setConfirmingEnd(false)}
                >
                  Keep fasting
                </button>
              </div>
            </div>
          ) : confirmingCancel ? (
            <div className="card stack" role="alertdialog" aria-labelledby="cancel-heading">
              <h2 id="cancel-heading">Discard this fast?</h2>
              <p className="muted">
                It will not appear in your history at all. This cannot be undone.
              </p>
              <div className="notice__actions">
                <button
                  type="button"
                  className="button button--danger"
                  disabled={discard.isPending}
                  onClick={() => discard.mutate(fast.id)}
                >
                  {discard.isPending ? 'Discarding…' : 'Discard'}
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setConfirmingCancel(false)}
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <div className="timer__actions">
              <button
                type="button"
                className="button button--primary"
                disabled={!online}
                onClick={() => setConfirmingEnd(true)}
              >
                End fast
              </button>
              <button
                type="button"
                className="button button--link"
                disabled={!online}
                onClick={() => setConfirmingCancel(true)}
              >
                Discard without recording
              </button>

              {!online && (
                <p className="field__hint">
                  Your timer keeps running. Ending this fast needs a connection.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="stack">
          <div className="card stack">
            <h2>Ready when you are</h2>
            <p className="muted">
              {plan
                ? `Your plan is ${plan.label}: fast ${formatDuration(goalMinutes)}.`
                : 'Choose a plan first.'}
            </p>

            {confirmingExtended ? (
              <ExtendedFastNotice
                hours={goalMinutes / 60}
                confirmLabel="I understand, start the fast"
                onConfirm={() => doStart(backdating ? Number(backdateHours) || 0 : 0)}
                onCancel={() => setConfirmingExtended(false)}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={!plan || begin.isPending || !online}
                  onClick={requestStart}
                >
                  {begin.isPending ? 'Starting…' : 'Start fast'}
                </button>

                {!online && (
                  <p className="field__hint">
                    Starting a fast needs a connection, so Fastr can record when it began.
                  </p>
                )}

                {/* Requirement 5.3. The common case is "I stopped eating at 8pm and it is now morning". */}
                {backdating ? (
                  <div className="timer__backdate">
                    <label className="field__label" htmlFor="backdate-hours">
                      How many hours ago did you start?
                    </label>
                    <input
                      id="backdate-hours"
                      className="field__input"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={48}
                      step={0.5}
                      value={backdateHours}
                      onChange={(event) => setBackdateHours(event.target.value)}
                    />
                    <button
                      type="button"
                      className="button button--link"
                      onClick={() => setBackdating(false)}
                    >
                      Never mind
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button button--link"
                    onClick={() => setBackdating(true)}
                  >
                    I started earlier
                  </button>
                )}
              </>
            )}
          </div>

          <p className="muted">
            {stageAt(0).name} is where every fast begins. Fastr shows each stage as you reach it.
          </p>
        </div>
      )}

      {/* Water sits on this screen whether or not a fast is running: staying hydrated is not conditional. */}
      {profile.data && (
        <WaterTracker
          timeZone={profile.data.timeZone}
          unit={profile.data.volumeUnit}
          goalMl={profile.data.waterGoalMl}
        />
      )}
    </div>
  );
}

export type { Fast };
