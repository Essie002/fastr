-- Turning reminder schedules into due notifications. Requirement 8.
--
-- A reminder is a rule ("20:00 on weekdays"), not an event. Something has to turn it into a row the sender can
-- pick up, and that something runs hourly rather than every minute: a reminder is wanted at a wall-clock time, and
-- an hourly sweep that queues anything due in the next hour is precise enough while doing a twenty-fourth of the
-- work.

create or replace function public.queue_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  queued integer := 0;
begin
  /*
   * The time-zone conversion is the whole function, so it is worth reading slowly.
   *
   *   now() at time zone p.time_zone          -- the user's wall clock, as a naive timestamp
   *   ::date                                  -- their calendar day
   *   + r.local_time                           -- their chosen wall-clock time, still naive
   *   at time zone p.time_zone                 -- back to an instant
   *
   * Converting out and back is what makes this correct across daylight saving changes, and it is why time_zone
   * holds an IANA name like 'Africa/Nairobi' rather than an offset. An offset would be an hour wrong for half the
   * year (Requirement 8.4).
   */
  with candidate as (
    select
      r.id,
      r.user_id,
      ((now() at time zone p.time_zone)::date + r.local_time) at time zone p.time_zone as due_at,
      (now() at time zone p.time_zone)::date                                           as local_day
    from reminders r
    join profiles p on p.id = r.user_id
    where r.enabled
      -- extract(dow) is 0 for Sunday, which is the convention the weekdays array uses.
      and extract(dow from now() at time zone p.time_zone)::smallint = any (r.weekdays)
  ),
  ready as (
    select c.*
      from candidate c
     where
       -- Within the next hour, or just past. The lower bound stops an hourly run queueing this morning's reminder
       -- again at six in the evening; the sender's own staleness rule is a safety net, not the mechanism.
       c.due_at between now() - interval '5 minutes' and now() + interval '1 hour'

       -- Requirement 8.3. No reminder to start a fast while one is already running.
       and not exists (
         select 1 from fasts f
          where f.user_id = c.user_id
            and f.status = 'active'
       )

       -- One per day, however many times this runs. Compared on the user's own local day, so someone who crosses a
       -- time zone does not get a second reminder for what is, to them, the same day.
       and not exists (
         select 1 from notifications n
          where n.user_id = c.user_id
            and n.kind = 'reminder'
            and (n.due_at at time zone (select time_zone from profiles where id = c.user_id))::date
                = c.local_day
       )
  )
  insert into notifications (user_id, kind, due_at, status)
  select r.user_id, 'reminder', r.due_at, 'pending'
    from ready r;

  get diagnostics queued = row_count;
  return queued;
end;
$$;

revoke all on function public.queue_due_reminders() from public, anon, authenticated;
grant execute on function public.queue_due_reminders() to service_role;

-- Hourly, on the hour. Guarded like the sender's schedule, because a Postgres without pg_cron should still
-- migrate.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('fastr-queue-reminders')
     where exists (select 1 from cron.job where jobname = 'fastr-queue-reminders');

    perform cron.schedule('fastr-queue-reminders', '0 * * * *', $job$ select public.queue_due_reminders(); $job$);
  end if;
exception
  when others then
    raise notice 'could not install the reminder schedule: %', sqlerrm;
end;
$$;
