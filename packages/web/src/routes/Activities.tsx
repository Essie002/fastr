import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  activityIcon,
  activityLabel,
  describeWeekdays,
  isVolumeActivity,
  nextOccurrence,
} from '@fastr/shared';
import {
  activitiesQueryKey,
  createActivity,
  createSchedule,
  deleteActivity,
  fetchActivities,
  updateActivity,
  type Activity,
  type ActivitySchedule,
} from '../data/activities.js';
import { activityLogQueryKey } from '../data/activityLog.js';
import { waterQueryKey } from '../data/water.js';
import { useProfile } from '../data/useProfile.js';
import { ActivityForm, type ActivityDraft } from '../components/ActivityForm.js';
import { LogActivityButton } from '../components/LogActivityButton.js';
import { ActivityHistory } from '../components/ActivityHistory.js';

/**
 * Activities: what you want to be reminded about, and when. Requirements 1, 6, 7.
 *
 * Its own screen rather than a section of Settings, because this is something a user comes here to *do* — log
 * a walk, silence a reminder that is annoying them — not something they configure once and forget.
 */

/** "Every day at 07:00", "Weekdays every 2 hours, 08:00 to 20:00". Requirement 7.2. */
function describeSchedule(schedule: ActivitySchedule): string {
  const days = describeWeekdays(schedule.weekdays);

  if (schedule.kind === 'at') return `${days} at ${schedule.localTime}`;

  const minutes = schedule.intervalMinutes ?? 0;
  const every =
    minutes % 60 === 0
      ? minutes === 60
        ? 'every hour'
        : `every ${minutes / 60} hours`
      : `every ${minutes} minutes`;

  return `${days} ${every}, ${schedule.windowStart} to ${schedule.windowEnd}`;
}

/** The soonest next occurrence across an activity's schedules, or null. Requirement 7.4. */
function nextFor(activity: Activity, timeZone: string, now: Date): Date | null {
  const candidates = activity.schedules
    .map((schedule) => nextOccurrence(schedule, now, timeZone))
    .filter((at): at is Date => at !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  return candidates[0] ?? null;
}

function describeNext(at: Date | null, timeZone: string): string {
  if (at === null) return 'Not scheduled';

  const time = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  const day = new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);

  if (day === today) return `Next at ${time} today`;

  const weekday = new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'long' }).format(at);
  return `Next at ${time} on ${weekday}`;
}

export default function Activities() {
  const queryClient = useQueryClient();
  const profile = useProfile();
  const activities = useQuery({ queryKey: activitiesQueryKey, queryFn: fetchActivities });

  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timeZone = profile.data?.timeZone ?? 'UTC';
  // Captured once per render rather than ticking: a "next at" label does not need to be live to the second,
  // and a timer here would re-render the whole list every second for no benefit.
  const now = new Date();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: activitiesQueryKey });

  const add = useMutation({
    mutationFn: async (draft: ActivityDraft) => {
      const activity = await createActivity({
        typeKey: draft.typeKey,
        customLabel: draft.customLabel,
        durationMinutes: draft.durationMinutes,
        notifyEnd: draft.notifyEnd,
      });
      // Two writes, not one transaction. An activity with no schedule is harmless — it simply never fires —
      // so a failure here leaves something the user can see and fix, rather than a half-created row.
      await createSchedule(activity.id, draft.schedule);
    },
    onSuccess: async () => {
      setAdding(false);
      setError(null);
      await invalidate();
    },
    onError: (caught: Error) =>
      setError(
        /at most 20 activities/i.test(caught.message)
          ? 'You can have at most 20 activities. Delete one to add another.'
          : 'That did not save. Check your connection and try again.',
      ),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateActivity(id, { enabled }),
    onSuccess: invalidate,
  });

  const remove = useMutation({ mutationFn: deleteActivity, onSuccess: invalidate });

  const logged = async () => {
    // A water completion writes to water_entries, so both caches have to be told.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: activityLogQueryKey }),
      queryClient.invalidateQueries({ queryKey: waterQueryKey }),
    ]);
  };

  const rows = activities.data ?? [];

  return (
    <>
      <h1>Activities</h1>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {activities.isPending && <p role="status">Loading…</p>}

      {!activities.isPending && rows.length === 0 && !adding && (
        // Requirement 6.5. Says what to do rather than rendering an empty list and leaving the user to guess.
        <div className="card stack">
          <h2>Nothing yet</h2>
          <p className="muted">
            Add a walk, a swim, or a nudge to drink water, and Fastr will remind you when you asked
            it to.
          </p>
          <button className="button button--primary" type="button" onClick={() => setAdding(true)}>
            Add your first activity
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="activities">
          {rows.map((activity) => {
            const label = activityLabel(activity.typeKey, activity.customLabel);
            const next = activity.enabled ? nextFor(activity, timeZone, now) : null;

            return (
              <li className="card stack activities__item" key={activity.id}>
                <div className="activities__head">
                  <h2 className="activities__title">
                    <span aria-hidden="true">{activityIcon(activity.typeKey)}</span> {label}
                  </h2>

                  {/* Requirement 7.3. One action, from the list, without opening anything. */}
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={activity.enabled}
                      onChange={(event) =>
                        toggle.mutate({ id: activity.id, enabled: event.target.checked })
                      }
                    />
                    <span className="sr-only">{`Remind me about ${label}`}</span>
                    <span aria-hidden="true">{activity.enabled ? 'On' : 'Off'}</span>
                  </label>
                </div>

                {!isVolumeActivity(activity.typeKey) && (
                  <p className="muted activities__meta">
                    {activity.durationMinutes} minutes
                    {activity.notifyEnd ? ', with an end reminder' : ''}
                  </p>
                )}

                {activity.schedules.length === 0 ? (
                  <p className="muted">No schedule yet, so this will not remind you.</p>
                ) : (
                  <ul className="activities__schedules">
                    {activity.schedules.map((schedule) => (
                      <li key={schedule.id} className="muted">
                        {describeSchedule(schedule)}
                        {!schedule.enabled && ' (off)'}
                      </li>
                    ))}
                  </ul>
                )}

                <p className="activities__next">
                  {activity.enabled ? describeNext(next, timeZone) : 'Reminders are off'}
                </p>

                <div className="row">
                  <LogActivityButton activity={activity} onLogged={logged} />
                  <button
                    className="button button--link"
                    type="button"
                    onClick={() => remove.mutate(activity.id)}
                    aria-label={`Delete ${label}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <ActivityForm
          busy={add.isPending}
          onSubmit={(draft) => add.mutate(draft)}
          onCancel={() => {
            setAdding(false);
            setError(null);
          }}
        />
      ) : (
        rows.length > 0 && (
          <button
            className="button button--secondary"
            type="button"
            onClick={() => setAdding(true)}
          >
            Add another activity
          </button>
        )
      )}

      <ActivityHistory timeZone={timeZone} />
    </>
  );
}
