import {
  formatDuration,
  formatLocalTime,
  minutesToNextStage,
  nextStage,
  stageAt,
} from '@fastr/shared';
import type { Fast, TimeZone } from '@fastr/shared';
import { ProgressRing } from './ProgressRing.js';

/**
 * The running timer. Requirements 5.4, 5.7, 6.2.
 *
 * Everything here is derived from `elapsedMinutes`, which the screen recomputes from the fast's stored start
 * on every tick. Nothing is accumulated, so a reload, a sleeping phone or a second device all agree.
 *
 * The visible numbers are `aria-hidden` and the same facts are offered once as text. A live region that
 * updated every second would make a screen reader unusable, so announcements are left to the caller, which
 * fires them only on a stage change or at the goal.
 */
export function TimerDisplay({
  fast,
  elapsedMinutes,
  timeZone,
}: {
  fast: Fast;
  elapsedMinutes: number;
  timeZone: TimeZone;
}) {
  const goal = fast.goalMinutes;
  const remaining = goal - elapsedMinutes;
  const past = remaining < 0;
  const stage = stageAt(elapsedMinutes);
  const upcoming = nextStage(elapsedMinutes);
  const untilNext = minutesToNextStage(elapsedMinutes);
  const goalAt = new Date(Date.parse(fast.startAt) + goal * 60_000);

  return (
    <div className="timer">
      <ProgressRing fraction={elapsedMinutes / goal} goalMinutes={goal}>
        <span className="timer__elapsed" aria-hidden="true">
          {formatDuration(elapsedMinutes)}
        </span>
        <span className="timer__remaining" aria-hidden="true">
          {past
            ? `${formatDuration(-remaining)} past your goal`
            : `${formatDuration(remaining)} to go`}
        </span>
      </ProgressRing>

      {/*
        The whole state as one sentence, for a screen reader and for anyone who wants it in words. Not a live
        region: it is read on demand, and re-announcing it every second would be intolerable.
      */}
      <p className="sr-only">
        Fasting for {formatDuration(elapsedMinutes)} of a {formatDuration(goal)} goal.{' '}
        {past
          ? `You passed your goal ${formatDuration(-remaining)} ago.`
          : `${formatDuration(remaining)} remaining, finishing at ${formatLocalTime(goalAt, timeZone)}.`}{' '}
        Current stage: {stage.name}.
      </p>

      <p className="timer__goal-time muted" aria-hidden="true">
        {past ? 'Goal was at' : 'Goal at'} {formatLocalTime(goalAt, timeZone)}
      </p>

      <div className="timer__stage card">
        <h2 className="timer__stage-name">{stage.name}</h2>
        <p className="timer__stage-description">{stage.description}</p>
        {upcoming && untilNext !== null ? (
          <p className="muted timer__stage-next">
            Next: {upcoming.name} in {formatDuration(untilNext)}
          </p>
        ) : (
          <p className="muted timer__stage-next">This is the last stage Fastr tracks.</p>
        )}
      </div>
    </div>
  );
}
