/**
 * Sends the notifications that are due. Requirements 7.3, 7.7, 7.8, 7.11, 18.5.
 *
 * Called every minute by `pg_cron`. This is the only part of Fastr that runs with no user present, and the whole
 * reason the project needs a back end at all: a phone in a pocket cannot wake itself to announce that a fast has
 * finished.
 *
 * Runs with the service role, so Row Level Security does not apply — necessary, since it acts on behalf of every
 * user, and the reason that key exists nowhere else.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { STAGES } from '../_shared/stages.ts';
import { PLANS } from '../_shared/plans.ts';
import { findActivityType } from '../_shared/activityTypes.ts';

/** Requirement 7.8. Anything later than this is reported rather than sent. */
const STALE_AFTER_MINUTES = 30;

/** One run's worth. Enough that a restored project catches up quickly, small enough to finish inside a minute. */
const BATCH = 200;

interface NotificationRow {
  id: string;
  user_id: string;
  fast_id: string | null;
  activity_id: string | null;
  // Third copy of this set. The others are the CHECK constraint on notifications.kind and the union in
  // packages/shared, which this cannot import because `functions deploy` bundles only this directory.
  // supabase/tests/notificationKinds.test.ts asserts all three agree.
  kind: 'goal' | 'stage' | 'hour_before' | 'reminder' | 'activity_start' | 'activity_end';
  stage_key: string | null;
  due_at: string;
  attempts: number;
}

interface ActivityRow {
  id: string;
  type_key: string | null;
  custom_label: string | null;
  duration_minutes: number;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface FastRow {
  id: string;
  plan_id: string;
  goal_minutes: number;
  start_at: string;
}

function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return hours === 0 ? `${mins}m` : `${hours}h ${String(mins).padStart(2, '0')}m`;
}

/**
 * The message for one notification.
 *
 * Composed here from the shared plan and stage data rather than stored on the row, so changing the wording is a
 * deploy rather than a migration, and a stage renamed in TypeScript cannot leave old queued rows announcing a
 * name that no longer exists.
 */
function compose(row: NotificationRow, fast: FastRow | undefined, activity?: ActivityRow) {
  const plan = fast ? PLANS.find((candidate) => candidate.id === fast.plan_id) : undefined;
  const planLabel = plan?.label ?? 'Your fast';

  // The activity's own name: its preset label, or the user's own words for a custom one.
  const activityType = activity ? findActivityType(activity.type_key) : undefined;
  const activityName = activityType?.label ?? activity?.custom_label?.trim() ?? 'your activity';

  switch (row.kind) {
    case 'goal': {
      const elapsed = fast ? (Date.parse(row.due_at) - Date.parse(fast.start_at)) / 60_000 : 0;
      return {
        title: `${planLabel} complete`,
        body: `You fasted ${formatDuration(elapsed)}. Well done.`,
        // One tag per fast per kind, so a notification cannot pile up behind an unread one.
        tag: `goal-${row.fast_id}`,
      };
    }
    case 'hour_before':
      return {
        title: 'One hour to go',
        body: `${planLabel} finishes in an hour.`,
        tag: `hour-${row.fast_id}`,
      };
    case 'stage': {
      const stage = STAGES.find((candidate) => candidate.key === row.stage_key);
      return {
        title: stage?.name ?? 'New fasting stage',
        body: stage?.description ?? 'You have reached a new stage of your fast.',
        // Shared across stages deliberately: six stage alerts on a long fast should replace one another rather
        // than stack up as six banners.
        tag: `stage-${row.fast_id}`,
      };
    }
    case 'reminder':
      return {
        title: 'Time to start your fast',
        body: 'Tap to start, or change this in settings.',
        tag: 'reminder',
      };
    case 'activity_start': {
      // Water is measured in volume, so "45 minutes" would be nonsense for it. Requirement 4.1.
      if (activityType?.unit === 'ml') {
        return {
          title: 'Time to drink water',
          body: 'Tap to log a glass.',
          tag: `activity-${row.activity_id}`,
        };
      }
      return {
        // A preset reads as a sentence; a custom label cannot, because it is a noun the app has never
        // seen and "Time for a physio" is wrong as often as it is right.
        title: activityType
          ? `Time for a ${activityType.label.toLowerCase()}`
          : `Time for: ${activityName}`,
        body: formatDuration(activity?.duration_minutes ?? 0),
        // One tag per activity, so a phone left unattended replaces rather than stacks. Requirement 4.6.
        tag: `activity-${row.activity_id}`,
      };
    }
    case 'activity_end':
      return {
        title: `${activityName} done?`,
        body: 'Tap to log it.',
        // Distinct from the start tag, or the end reminder would silently replace a start the user has
        // not looked at yet.
        tag: `activity-end-${row.activity_id}`,
      };
    default: {
      /*
       * Requirement 12.3. A kind with no branch is a build error here rather than a blank notification.
       *
       * Before this existed, `compose` had no default and returned `undefined` for an unhandled kind —
       * which then went through `JSON.stringify` and was delivered as a push with no title and no body.
       * The user got a silent, empty banner and nothing anywhere recorded a problem.
       */
      const unreachable: never = row.kind;
      throw new Error(`No notification copy for kind: ${String(unreachable)}`);
    }
  }
}

Deno.serve(async (request) => {
  // Requirement 18.5. Cron has no user and therefore no JWT, so a shared secret takes its place. Compared in
  // full rather than short-circuiting on the first differing byte would be better still; for a secret this long
  // the timing signal is not the weak link.
  const provided = request.headers.get('x-fastr-cron-secret');
  const expected = Deno.env.get('CRON_SECRET');

  if (!expected || !provided || provided !== expected) {
    return new Response('Forbidden', { status: 403 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:fastr@example.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );

  /*
   * Claim the due rows.
   *
   * One statement, and it marks them sent *before* delivery is attempted. That chooses "possibly not delivered"
   * over "possibly delivered twice": a missed fasting alert is a minor annoyance, a duplicate at three in the
   * morning is the kind of thing that gets an app deleted.
   *
   * `claim_due_notifications` wraps `for update skip locked`, so two overlapping runs cannot claim the same row —
   * the second sees nothing to do rather than blocking behind the first.
   */
  const { data: claimed, error: claimError } = await supabase.rpc('claim_due_notifications', {
    batch_size: BATCH,
  });

  if (claimError) {
    console.error('claim failed', claimError.message);
    return Response.json({ error: 'claim failed' }, { status: 500 });
  }

  const rows = (claimed ?? []) as NotificationRow[];
  if (rows.length === 0) return Response.json({ sent: 0, skipped: 0, failed: 0 });

  // Fetched in one query rather than per row: a catch-up run after a restored project can hold a few hundred.
  const fastIds = [
    ...new Set(rows.map((row) => row.fast_id).filter((id): id is string => id !== null)),
  ];
  const activityIds = [
    ...new Set(rows.map((row) => row.activity_id).filter((id): id is string => id !== null)),
  ];
  const userIds = [...new Set(rows.map((row) => row.user_id))];

  const [{ data: fasts }, { data: activities }, { data: subscriptions }] = await Promise.all([
    fastIds.length > 0
      ? supabase.from('fasts').select('id, plan_id, goal_minutes, start_at').in('id', fastIds)
      : Promise.resolve({ data: [] as FastRow[] }),
    // Alongside the fasts query rather than per row, for the same reason: one catch-up run can hold a few
    // hundred notifications, and a query each would be a few hundred round trips inside the send loop.
    activityIds.length > 0
      ? supabase
          .from('activities')
          .select('id, type_key, custom_label, duration_minutes')
          .in('id', activityIds)
      : Promise.resolve({ data: [] as ActivityRow[] }),
    supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', userIds),
  ]);

  const fastById = new Map((fasts ?? []).map((fast) => [(fast as FastRow).id, fast as FastRow]));
  const activityById = new Map(
    (activities ?? []).map((activity) => [(activity as ActivityRow).id, activity as ActivityRow]),
  );
  const subscriptionsByUser = new Map<string, SubscriptionRow[]>();
  for (const row of (subscriptions ?? []) as (SubscriptionRow & { user_id: string })[]) {
    const list = subscriptionsByUser.get(row.user_id) ?? [];
    list.push(row);
    subscriptionsByUser.set(row.user_id, list);
  }

  const now = Date.now();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  const stale: string[] = [];
  /** Claimed and not stale, so delivery was attempted. What `sent_at` should be stamped on. */
  const attempted: string[] = [];
  const gone: string[] = [];
  const succeeded: string[] = [];
  const softFailed: string[] = [];

  for (const row of rows) {
    /*
     * Requirement 7.8. A project restored after four days should not fire a hundred alerts about fasts that
     * ended on Tuesday. Marked skipped rather than deleted, so "why did I not get a notification" has an answer.
     */
    if (now - Date.parse(row.due_at) > STALE_AFTER_MINUTES * 60_000) {
      stale.push(row.id);
      skipped += 1;
      continue;
    }

    attempted.push(row.id);

    const activity = row.activity_id ? activityById.get(row.activity_id) : undefined;

    /*
     * Where tapping the notification lands. Requirement 4.7.
     *
     * Water goes to the root, which is the timer screen, because that is where the water logger lives and
     * logging a glass should be one tap from the banner. Everything else activity-shaped goes to the
     * activities screen. Fasting notifications keep the root they always had.
     */
    const url =
      row.kind === 'activity_start' || row.kind === 'activity_end'
        ? findActivityType(activity?.type_key)?.unit === 'ml'
          ? '/fastr/'
          : '/fastr/activities'
        : '/fastr/';

    const payload = JSON.stringify({
      ...compose(row, row.fast_id ? fastById.get(row.fast_id) : undefined, activity),
      url,
    });

    const targets = subscriptionsByUser.get(row.user_id) ?? [];

    for (const target of targets) {
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload,
        );
        succeeded.push(target.id);
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;

        if (status === 404 || status === 410) {
          // Requirement 7.11. The push service says this subscription is gone for good: the browser was
          // uninstalled, or its registration was reset. Keeping it would retry for ever.
          gone.push(target.endpoint);
        } else {
          // 429 or 5xx: the service is busy or broken, and the subscription may still be good. Counted so a
          // persistently failing device is visible in settings.
          softFailed.push(target.id);
        }
        failed += 1;
      }
    }
  }

  // Batched, so one run issues a handful of statements rather than one per notification.
  await Promise.all([
    stale.length > 0
      ? supabase.from('notifications').update({ status: 'skipped' }).in('id', stale)
      : null,
    /*
     * Stamped on the rows that were actually attempted, which is every claimed row except the stale ones.
     *
     * This used to pass `rows.map(...)` — all of them — so the rows marked `skipped` two statements above
     * also got a `sent_at`. The result was a row claiming both that it was skipped and that it was sent at a
     * particular time, which is the one question `sent_at` exists to answer. Harmless to delivery and
     * actively misleading to anyone debugging a missing notification.
     */
    attempted.length > 0
      ? supabase
          .from('notifications')
          .update({ sent_at: new Date().toISOString() })
          .in('id', attempted)
      : null,
    gone.length > 0 ? supabase.from('push_subscriptions').delete().in('endpoint', gone) : null,
    softFailed.length > 0 ? supabase.rpc('bump_push_failures', { ids: softFailed }) : null,
    succeeded.length > 0
      ? supabase
          .from('push_subscriptions')
          .update({ last_ok_at: new Date().toISOString(), failures: 0 })
          .in('id', succeeded)
      : null,
  ]);

  return Response.json({ sent, skipped, failed, claimed: rows.length });
});
