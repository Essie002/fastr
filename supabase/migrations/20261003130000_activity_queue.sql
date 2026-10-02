-- Queueing activity reminders, and cancelling them when the schedule changes. Requirements 2.4, 2.5, 3.4,
-- 3.6, 4.3, 4.4, 4.8, 8.2.

-- ---------------------------------------------------------------------------
-- Queueing
-- ---------------------------------------------------------------------------

create or replace function public.queue_due_activities()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  queued integer;
begin
  /*
   * The window, and why it is lopsided.
   *
   * Five minutes back absorbs a cron run that started late — the job is scheduled every fifteen minutes but
   * nothing guarantees it fires on the second, and an occurrence that fell two minutes before the run would
   * otherwise be lost for ever. Requirement 2.5 is why it is only five: enabling an activity in the evening
   * must not fire that morning's reminder, and the sender's own thirty-minute staleness rule is the backstop
   * if something does slip through.
   *
   * Twenty minutes forward covers the fifteen-minute cadence with five to spare, so a single skipped run
   * still leaves the next one able to place everything it missed.
   *
   * Overlapping windows mean consecutive runs see the same occurrence on purpose. That is safe only because
   * `notifications_unique_per_occurrence` makes the insert idempotent — the guarantee is in the schema, not
   * in this function, so rewriting this function cannot lose it.
   */
  with occ as (
    select *
    from activity_occurrences(now() - interval '5 minutes', now() + interval '20 minutes')
  ),

  starts as (
    insert into notifications (user_id, activity_id, activity_schedule_id, kind, due_at)
    select user_id, activity_id, schedule_id, 'activity_start', due_at
    from occ
    on conflict do nothing
    returning 1
  ),

  ends as (
    -- Requirement 4.4. Only where the user asked for one, which is off by default.
    insert into notifications (user_id, activity_id, activity_schedule_id, kind, due_at)
    select user_id, activity_id, schedule_id, 'activity_end', due_at + make_interval(mins => minutes)
    from occ
    where notify_end
    on conflict do nothing
    returning 1
  )

  select (select count(*) from starts) + (select count(*) from ends) into queued;

  return queued;
end;
$$;

comment on function public.queue_due_activities() is
  'Queues activity_start and activity_end notifications for occurrences falling due soon. Idempotent.';

revoke all on function public.queue_due_activities() from public, anon, authenticated;
grant execute on function public.queue_due_activities() to service_role;

-- ---------------------------------------------------------------------------
-- Cancelling
-- ---------------------------------------------------------------------------
--
-- Mirrors `sync_fast_notifications`: when the thing a notification describes changes, the pending queue is
-- wrong and is cancelled rather than corrected. Already-sent rows are left alone, being history.
--
-- Cancelled rather than deleted, so "why did I not get a reminder" has an answer, and because the unique
-- index is scoped to pending and sent — a cancelled occurrence can be queued again, which is exactly what
-- happens when a user disables an activity and changes their mind.
--
-- Requeueing is left to the next cron run rather than done here. It is at most fifteen minutes away, and
-- recomputing occurrences inside a trigger would put the schedule arithmetic in a second place, which is the
-- thing `activity_occurrences` exists to prevent.

create or replace function public.cancel_activity_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'activity_schedules' then
    update notifications
       set status = 'cancelled'
     where activity_schedule_id = old.id
       and status = 'pending';
  else
    update notifications
       set status = 'cancelled'
     where activity_id = old.id
       and status = 'pending';
  end if;

  return null; -- after trigger
end;
$$;

/*
 * Scoped to the columns that change what is due, the way the fasts trigger is.
 *
 * Firing on every update would cancel the queue when a user renamed a custom activity, which changes the
 * notification's words but not its timing — and the next cron run would requeue it, so the only visible
 * effect would be a reminder lost if the rename happened in the fifteen minutes before it was due.
 */
create trigger activity_schedules_cancel_notifications
  after update of local_time, window_start, window_end, interval_minutes, weekdays, enabled
  on public.activity_schedules
  for each row execute function public.cancel_activity_notifications();

create trigger activity_schedules_cancel_notifications_delete
  after delete on public.activity_schedules
  for each row execute function public.cancel_activity_notifications();

-- `duration_minutes` is included because the end notification is derived from it, and `notify_end` because
-- turning it off must withdraw an end reminder already queued.
create trigger activities_cancel_notifications
  after update of enabled, duration_minutes, notify_end
  on public.activities
  for each row execute function public.cancel_activity_notifications();

/*
 * Requirement 8.2. A change of time zone moves every future occurrence.
 *
 * Without this, someone who flies from Nairobi to London keeps getting yesterday's queue: rows whose due_at
 * was computed against the old offset, which are now at the wrong local time. Cancelling lets the next run
 * place them correctly.
 *
 * `notify_activities` is here too, so switching the master switch off withdraws what is already queued rather
 * than only stopping new rows — otherwise the next twenty minutes of reminders still arrive after the user
 * has explicitly asked for silence.
 */
create or replace function public.cancel_activity_notifications_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update notifications
     set status = 'cancelled'
   where user_id = new.id
     and kind in ('activity_start', 'activity_end')
     and status = 'pending';

  return null;
end;
$$;

create trigger profiles_cancel_activity_notifications
  after update of time_zone, notify_activities on public.profiles
  for each row
  when (old.time_zone <> new.time_zone or old.notify_activities <> new.notify_activities)
  execute function public.cancel_activity_notifications_for_user();

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------
--
-- Requirement 3.6. Every fifteen minutes, not hourly: an interval schedule can place an occurrence at 10:30,
-- and an hourly job physically cannot queue it in time. The existing hourly fasting reminder job is left
-- exactly as it is.
--
-- Four runs an hour instead of one. Each is a single `insert ... select` over the enabled schedules, and the
-- notification sender already runs every minute, so this is not a meaningful change in load.
--
-- Guarded the same way the existing jobs are, so a Postgres without pg_cron still migrates.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('fastr-queue-activities')
     where exists (select 1 from cron.job where jobname = 'fastr-queue-activities');

    perform cron.schedule(
      'fastr-queue-activities',
      '*/15 * * * *',
      $job$ select public.queue_due_activities(); $job$
    );
  end if;
exception
  when others then
    raise notice 'could not install the activity schedule: %', sqlerrm;
end;
$$;
