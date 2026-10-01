-- The claiming statement, and the scheduled job that drives it. Requirements 7.7 and 18.5.

-- ---------------------------------------------------------------------------
-- claim_due_notifications
-- ---------------------------------------------------------------------------
-- Takes the notifications that are due and marks them sent, atomically, returning what was taken.
--
-- Two decisions carry the whole design here.
--
-- `for update skip locked` is what makes overlapping runs safe. Cron fires every minute; a run that occasionally
-- takes longer than a minute will overlap the next one. With `skip locked` the second run's select steps over the
-- rows the first has locked and finishes quickly with nothing to do, rather than blocking behind it and then
-- sending the same notifications again.
--
-- The status moves to 'sent' before any push is attempted. That is deliberately pessimistic: it chooses "possibly
-- not delivered" over "possibly delivered twice". A missed fasting alert is a minor annoyance; a duplicate at
-- three in the morning is the kind of thing that gets an app deleted. `attempts` records that a try happened, so
-- a genuinely broken push service is still visible.

create or replace function public.claim_due_notifications(batch_size integer default 200)
returns setof public.notifications
language sql
security definer
set search_path = public
as $$
  update notifications n
     set status     = 'sent',
         claimed_at = now(),
         attempts   = attempts + 1
   where n.id in (
     select id
       from notifications
      where status = 'pending'
        and due_at <= now()
      order by due_at
      limit batch_size
      for update skip locked
   )
  returning n.*;
$$;

-- Only the service role calls this. Revoking the rest stops a signed-in user claiming — and therefore silently
-- cancelling — their own notifications, or anybody else's.
revoke all on function public.claim_due_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_due_notifications(integer) to service_role;

-- ---------------------------------------------------------------------------
-- bump_push_failures
-- ---------------------------------------------------------------------------
-- Increments the failure count on subscriptions whose push attempt failed softly, a 429 or a 5xx.
--
-- A function rather than an update from the client, because `failures = failures + 1` across a set of ids cannot
-- be expressed through PostgREST without reading each row first and racing another run.

create or replace function public.bump_push_failures(ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update push_subscriptions
     set failures = failures + 1
   where id = any(ids);
$$;

revoke all on function public.bump_push_failures(uuid[]) from public, anon, authenticated;
grant execute on function public.bump_push_failures(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------
-- Guarded, because these extensions exist on the hosted platform and in the local stack but a bare `create
-- extension` would fail on a Postgres without them available, taking the whole migration with it.

do $$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
exception
  when others then
    raise notice 'pg_cron or pg_net unavailable; the notification schedule will not be installed';
end;
$$;

-- The URL and the secret come from database settings rather than being written in here, so the same migration
-- runs against the local stack and the hosted project. Set them once per project:
--
--   alter database postgres set app.settings.functions_url = 'https://<ref>.supabase.co/functions/v1';
--   alter database postgres set app.settings.cron_secret   = '<the same value as the function secret>';
--
-- Wrapped in a guard: a local stack has pg_cron but does not reliably fire it, and a project without the settings
-- should still migrate rather than fail.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Unscheduled first, so re-running this migration replaces the job rather than erroring on the name.
    perform cron.unschedule('fastr-send-notifications')
     where exists (select 1 from cron.job where jobname = 'fastr-send-notifications');

    perform cron.schedule(
      'fastr-send-notifications',
      '* * * * *',
      $job$
      select net.http_post(
        url     := current_setting('app.settings.functions_url', true) || '/send-notifications',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'x-fastr-cron-secret', current_setting('app.settings.cron_secret', true)),
        timeout_milliseconds := 20000
      )
      where current_setting('app.settings.functions_url', true) is not null;
      $job$
    );
  end if;
exception
  when others then
    raise notice 'could not install the notification schedule: %', sqlerrm;
end;
$$;
