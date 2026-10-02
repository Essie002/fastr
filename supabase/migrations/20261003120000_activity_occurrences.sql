-- Turning schedules into instants. Requirements 2.1, 2.2, 2.4, 3.3, 3.5, 8.1, 8.3.
--
-- Both schedule shapes reduce to a set of timestamps, and keeping that reduction in its own function — rather
-- than inlining it into the queueing function — is the single most useful decision in this feature.
--
-- It is a pure function of the clock, the schedules and the users' time zones. That means a test can ask "what
-- does this schedule produce on this day in this zone" and get an answer without writing a notification,
-- claiming anything, or asserting on a queue. The daylight-saving case in particular is only testable because
-- of this: the arithmetic lives in `at time zone`, which is Postgres's job and is correct, and the test
-- asserts that rather than reimplementing the rule in TypeScript and comparing two guesses.

-- `as_of` defaults to now() and exists for one reason: it makes the daylight-saving case testable without
-- mocking a clock. A test can ask what a 09:00 schedule produces on the two days either side of a real
-- transition and get the answer from this function rather than from a reimplementation of it in the test —
-- which would only prove that two pieces of arithmetic agree with each other. The scheduler passes nothing.
create or replace function public.activity_occurrences(
  from_at timestamptz,
  to_at   timestamptz,
  as_of   timestamptz default now()
)
returns table (
  schedule_id uuid,
  activity_id uuid,
  user_id     uuid,
  due_at      timestamptz,
  minutes     integer,
  notify_end  boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with scheduled as (
    select
      s.id   as schedule_id,
      a.id   as activity_id,
      s.user_id,
      s.kind,
      s.weekdays,
      s.local_time,
      s.window_start,
      s.window_end,
      s.interval_minutes,
      a.duration_minutes as minutes,
      a.notify_end,
      p.time_zone,
      /*
       * Three local days, not one.
       *
       * A window the user thinks of as "today" can start before `from_at` and end after `to_at` in UTC, and a
       * schedule at 00:15 local is a different UTC date from the same user's 23:45. Generating yesterday,
       * today and tomorrow and then filtering by the requested range is the simple way to be right at every
       * offset, including the ones that are a whole day away from UTC. The extra rows are discarded by the
       * final `where`, and there are at most three per schedule.
       */
      generate_series(
        (as_of at time zone p.time_zone)::date - 1,
        (as_of at time zone p.time_zone)::date + 1,
        interval '1 day'
      )::date as local_day
    from activity_schedules s
    join activities a on a.id = s.activity_id
    join profiles p on p.id = s.user_id
    where
      s.enabled
      and a.enabled
      -- Requirement 4.8. The master switch, read here so a disabled user produces no occurrences at all
      -- rather than being filtered later.
      and p.notify_activities
  ),

  due as (
    -- kind = 'at': one occurrence on each matching local day.
    select
      schedule_id,
      activity_id,
      user_id,
      minutes,
      notify_end,
      ((local_day + local_time) at time zone time_zone) as due_at
    from scheduled
    where
      kind = 'at'
      -- `extract(dow)` on the local *day*, not on now(), or a schedule would be tested against today's
      -- weekday while being placed on yesterday's date.
      and extract(dow from local_day)::smallint = any (weekdays)

    union all

    -- kind = 'every': from window_start, stepping by the interval, up to and including window_end.
    --
    -- Requirement 3.5. `generate_series` stops at or before its end bound, so the last occurrence never
    -- falls outside the window — an 08:00–20:00 window on a 150-minute interval ends at 18:30, not 21:00.
    select
      s.schedule_id,
      s.activity_id,
      s.user_id,
      s.minutes,
      s.notify_end,
      slot
    from scheduled s
    cross join lateral generate_series(
      (s.local_day + s.window_start) at time zone s.time_zone,
      (s.local_day + s.window_end) at time zone s.time_zone,
      make_interval(mins => s.interval_minutes)
    ) as slot
    where
      s.kind = 'every'
      and extract(dow from s.local_day)::smallint = any (s.weekdays)
  )

  select schedule_id, activity_id, user_id, due_at, minutes, notify_end
  from due
  where due_at >= from_at and due_at <= to_at;
$$;

comment on function public.activity_occurrences(timestamptz, timestamptz, timestamptz) is
  'Occurrences for every enabled schedule between two instants. Pure: reads schedules and time zones, writes nothing.';

-- Service role only. It is `security definer` so it can read across users, which is exactly why no client
-- should be able to call it: it would otherwise report the existence and timing of other people's schedules.
revoke all on function public.activity_occurrences(timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.activity_occurrences(timestamptz, timestamptz, timestamptz)
  to service_role;
