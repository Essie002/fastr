-- Makes the notification queue able to carry activity reminders. Requirement 11.
--
-- Three things in the current schema block this outright, and each is removed deliberately rather than
-- worked around, because every one of them is load-bearing for fasting and would be easy to reinstate by
-- accident later.

-- ---------------------------------------------------------------------------
-- 1. The constraint that rejected activity notifications
-- ---------------------------------------------------------------------------
--
-- `reminder_has_no_fast` reads: either you are a 'reminder' and have no fast, or you are something else and
-- MUST have a fast. That second half is the problem — it was written when every non-reminder notification
-- was about a fast, which was true at the time and is a closed-world assumption. An activity notification
-- has no fast_id and is not a 'reminder', so Postgres refuses the insert.
--
-- Replaced below by `notification_reference`, which states the same intent per kind without assuming the
-- set of kinds is finished.

alter table public.notifications drop constraint reminder_has_no_fast;

-- ---------------------------------------------------------------------------
-- 2. What an activity notification points at
-- ---------------------------------------------------------------------------
--
-- Both columns, not one. The schedule is what produced the occurrence and is what the dedupe index keys on;
-- the activity is what the sender needs to compose the text, and reaching it through the schedule would mean
-- a join per notification inside the send loop. Both cascade, so deleting either cleans up the queue without
-- the trigger in the next migration having to.

alter table public.notifications
  add column activity_id uuid references public.activities (id) on delete cascade,
  add column activity_schedule_id uuid references public.activity_schedules (id) on delete cascade;

alter table public.notifications
  drop constraint notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check check (
    kind in ('goal', 'stage', 'hour_before', 'reminder', 'activity_start', 'activity_end')
  );

/*
 * Each kind carries exactly the references it needs and none of the others.
 *
 * Stated per kind rather than as "a fast or an activity, not both", because the weaker version permits a
 * 'goal' with no fast_id — and a goal notification with nothing to describe is a notification the sender
 * cannot compose, discovered at send time on somebody's phone rather than at write time here.
 */
alter table public.notifications
  add constraint notification_reference check (
    (
      kind in ('goal', 'stage', 'hour_before')
      and fast_id is not null
      and activity_id is null
      and activity_schedule_id is null
    )
    or (
      -- The fasting reminder. Belongs to a schedule in the older `reminders` table, which it does not
      -- reference: it is one per user per day and has nothing to point at. See Requirement 13.
      kind = 'reminder'
      and fast_id is null
      and activity_id is null
      and activity_schedule_id is null
    )
    or (
      kind in ('activity_start', 'activity_end')
      and fast_id is null
      and activity_id is not null
      and activity_schedule_id is not null
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Duplicate protection for activity rows
-- ---------------------------------------------------------------------------
--
-- `notifications_unique_per_fast` is `where fast_id is not null`, so it does not see activity rows at all.
-- Without a parallel index, nothing stops the scheduling function queueing the same occurrence twice — and
-- the function runs every fifteen minutes with a twenty-minute lookahead, so overlapping runs see the same
-- occurrence on purpose.
--
-- This index is what lets that function be a plain `insert ... on conflict do nothing` with no bookkeeping
-- of what it already queued. The guarantee lives in the schema, so a later rewrite of the function cannot
-- lose it. It is also what replaces the old "one reminder per user per local day" rule, which was the
-- previous answer to this question and would have collapsed four activities a day into one notification.
--
-- Scoped to pending and sent: a cancelled occurrence must be re-queueable, which is exactly what happens
-- when a user disables an activity and re-enables it.
create unique index notifications_unique_per_occurrence
  on public.notifications (activity_schedule_id, kind, due_at)
  where activity_schedule_id is not null and status in ('pending', 'sent');

-- ---------------------------------------------------------------------------
-- The master switch
-- ---------------------------------------------------------------------------
--
-- Requirement 4.8. Independent of notify_goal / notify_stages / notify_hour_before, because someone who
-- wants to know when their fast ends and does not want to be nagged about walking should not have to delete
-- their schedules to get there.
alter table public.profiles
  add column notify_activities boolean not null default true;

comment on column public.profiles.notify_activities is
  'Master switch for activity reminders. Independent of the fasting notification preferences.';
