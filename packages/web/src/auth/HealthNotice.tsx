import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet } from 'react-router-dom';
import {
  acknowledgeHealthNotice,
  captureTimeZone,
  fetchProfile,
  profileQueryKey,
} from '../data/profile.js';

/**
 * The health notice. Requirements 1.5 and 17.1.
 *
 * A gate rather than a dismissible banner, and shown once per account rather than once per device, which
 * is why the acknowledgement lives on the profile and not in `localStorage`. Fasting is not safe for
 * everyone, and "they probably saw it on their old phone" is not good enough for the one screen that says
 * so.
 *
 * Time zone capture rides along here (Requirement 1.6) because this is the first render after sign-in
 * that already has the profile in hand, so it costs no extra request.
 */

export const HEALTH_NOTICE_TEXT = [
  'Fastr is a tracker, not medical advice. It cannot know anything about your health.',
  'Fasting does not suit everyone. If you are pregnant or breastfeeding, under 18, diabetic, taking medication with food, underweight, or have any history of an eating disorder, do not fast without talking to a doctor first.',
  'Stop if you feel faint, unwell, or unusually weak, and speak to a doctor before trying anything longer than a day.',
];

export function HealthNoticeGate() {
  const queryClient = useQueryClient();

  const profile = useQuery({ queryKey: profileQueryKey, queryFn: fetchProfile });

  const acknowledge = useMutation({
    mutationFn: async () => {
      const updated = await acknowledgeHealthNotice();
      // Best effort, and deliberately not awaited into the failure path: a time zone that does not save
      // is a wrong clock on one screen, and blocking the user behind it would be worse.
      await captureTimeZone(updated).catch(() => null);
      return updated;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryKey }),
  });

  /**
   * Has the profile ever settled, either way?
   *
   * Taken from the query's own timestamps, which only ever move forward, rather than from `isLoading`.
   * Gating on `isLoading` produces an infinite loop, and the loop is worth describing because nothing
   * about it looks like one.
   *
   * With an errored profile and no data, any refetch puts the query back into a pending state, so
   * `isLoading` becomes true *again*. The gate then swaps its child for nothing, unmounting the screen
   * behind it. React Query refetches a stale query whenever a new observer mounts, so the next time the
   * gate renders its child, that child mounts, refetches, and flips the gate back. Measured at roughly
   * ten thousand requests in half a second, with a blank screen throughout.
   *
   * These two timestamps are set on the first success or failure and never cleared, so the gate stops
   * rendering nothing after the first attempt and the screen behind it stays mounted.
   */
  const hasSettled = profile.dataUpdatedAt > 0 || profile.errorUpdatedAt > 0;

  // Only on the very first attempt, so a first-time user does not glimpse the app before being
  // interrupted by the notice.
  if (!hasSettled) return null;

  // A failed profile read must not gate the app: the notice is shown when we know it has not been
  // acknowledged, not when we cannot tell. The screens behind this report the error themselves.
  if (!profile.data) return <Outlet />;

  if (profile.data.healthNoticeAt !== null) return <Outlet />;

  return (
    <div className="stack">
      <h1>Before you start</h1>
      <div className="card stack">
        {HEALTH_NOTICE_TEXT.map((paragraph) => (
          <p key={paragraph.slice(0, 24)}>{paragraph}</p>
        ))}

        {acknowledge.isError && (
          <p role="alert" style={{ color: 'var(--danger)' }}>
            That did not save. Check your connection and try again.
          </p>
        )}

        <button
          type="button"
          className="button button--primary"
          onClick={() => acknowledge.mutate()}
          disabled={acknowledge.isPending}
        >
          {acknowledge.isPending ? 'Saving…' : 'I understand'}
        </button>
      </div>
    </div>
  );
}
