-- A helper the reminder tests use to ask Postgres what time it is for a given user.
--
-- Exists so a test does not have to reimplement the `at time zone` conversion it is trying to verify. A test that
-- computes the expected local time in JavaScript and compares it against SQL is really testing that two
-- implementations agree, which is not the question — the question is whether the function fires at the user's
-- wall-clock time.
--
-- Service role only, like the other functions here. It leaks nothing (a time zone the caller already owns), but
-- there is no reason for a client to call it.

create or replace function public.fastr_test_local_now(user_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'time', to_char(now() at time zone p.time_zone, 'HH24:MI'),
    'dow',  extract(dow from now() at time zone p.time_zone)::smallint,
    'date', (now() at time zone p.time_zone)::date
  )
  from profiles p
  where p.id = fastr_test_local_now.user_id;
$$;

revoke all on function public.fastr_test_local_now(uuid) from public, anon, authenticated;
grant execute on function public.fastr_test_local_now(uuid) to service_role;
