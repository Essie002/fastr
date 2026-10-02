import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { activityLabel, isVolumeActivity } from '@fastr/shared';
import { recordCompletion } from '../data/activityLog.js';
import type { Activity } from '../data/activities.js';

/**
 * Recording that an activity happened. Requirement 5.
 *
 * One tap for the common case, which is "I did the thing, for about as long as I said I would". Asking for the
 * duration every time would make logging a twenty-minute walk a three-field form, and the number it collects is
 * one the user already told us when they created the activity.
 *
 * Water is the exception: a volume, and a volume the user genuinely chooses each time, so it gets its own
 * amounts. It also writes through the existing water feature rather than to `activity_log` — see
 * `data/activityLog.ts`.
 */

const WATER_AMOUNTS = [250, 500] as const;

export function LogActivityButton({
  activity,
  onLogged,
}: {
  activity: Activity;
  onLogged: () => void | Promise<void>;
}) {
  const [done, setDone] = useState(false);
  const label = activityLabel(activity.typeKey, activity.customLabel);
  const isWater = isVolumeActivity(activity.typeKey);

  const log = useMutation({
    mutationFn: (ml?: number) =>
      recordCompletion({
        activityId: activity.id,
        typeKey: activity.typeKey,
        customLabel: activity.customLabel,
        minutes: isWater ? null : activity.durationMinutes,
        ml,
      }),
    onSuccess: async () => {
      // A moment of acknowledgement, then back. Without it a tap that writes a row silently looks like a
      // tap that did nothing, and people tap again.
      setDone(true);
      setTimeout(() => setDone(false), 2000);
      await onLogged();
    },
  });

  if (done) {
    // `role="status"` rather than an alert: it is a confirmation, so it should be announced without
    // interrupting whatever the user is doing next.
    return (
      <p className="activities__logged" role="status">
        Logged
      </p>
    );
  }

  if (isWater) {
    return (
      <div className="row">
        {WATER_AMOUNTS.map((ml) => (
          <button
            key={ml}
            className="button button--secondary"
            type="button"
            disabled={log.isPending}
            onClick={() => log.mutate(ml)}
          >
            + {ml} ml
          </button>
        ))}
      </div>
    );
  }

  return (
    <button
      className="button button--secondary"
      type="button"
      disabled={log.isPending}
      onClick={() => log.mutate(undefined)}
      // Named per activity, so a screen reader hears which "Log it" this is in a list of several.
      aria-label={`Log ${label}`}
    >
      {log.isPending ? 'Logging…' : 'Log it'}
    </button>
  );
}
