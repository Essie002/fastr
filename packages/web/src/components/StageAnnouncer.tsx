import { stageAt } from '@fastr/shared';

/**
 * Announces the things worth interrupting for, and nothing else. Requirement 19.2.
 *
 * The timer itself is `aria-hidden`, because a live region carrying a number that changes every second is
 * unusable with a screen reader — it would talk continuously and never finish a sentence. So the only
 * announcements are the two moments that actually change something: reaching a new fasting stage, and
 * reaching the goal.
 *
 * `aria-live="polite"`, so it waits for a pause rather than cutting across whatever is being read.
 *
 * The region's *content* is derived, not stored. It changes only when the stage key or the goal state
 * changes, so React re-renders this text at most a handful of times across a sixteen-hour fast even though
 * its parent re-renders every second.
 */
export function StageAnnouncer({
  elapsedMinutes,
  goalMinutes,
}: {
  elapsedMinutes: number;
  goalMinutes: number;
}) {
  const stage = stageAt(elapsedMinutes);
  const reachedGoal = elapsedMinutes >= goalMinutes;

  const message = reachedGoal
    ? `Goal reached. You have been fasting for ${Math.floor(elapsedMinutes / 60)} hours.`
    : `Stage reached: ${stage.name}.`;

  return (
    <p className="sr-only" role="status" aria-live="polite">
      {message}
    </p>
  );
}
