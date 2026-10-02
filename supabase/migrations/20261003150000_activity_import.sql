-- Activities in the import, and in the row-count view. Requirement 12.6.
--
-- Replaces `import_fastr_export` wholesale rather than adding a second function, because the whole point of it
-- is that an import is one transaction: a separate call for activities could succeed after the fasts failed,
-- which is the half-imported state the original function exists to prevent.
--
-- The activity keys are optional throughout. An export taken before this feature has no `activities` key at
-- all, and Requirement 12.6 says it must still import — so every read below is a `coalesce` against an empty
-- array rather than an assumption about the file's shape.

create or replace function public.import_fastr_export(target_user uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing      integer;
  fasts_in      integer := 0;
  weights_in    integer := 0;
  water_in      integer := 0;
  notes_in      integer := 0;
  reminders_in  integer := 0;
  activities_in integer := 0;
  log_in        integer := 0;
  item          jsonb;
  schedule      jsonb;
  new_activity  uuid;
begin
  -- Re-checked inside the transaction, so two imports racing cannot both pass the Edge Function's check.
  select count(*) into existing from fasts where user_id = target_user;
  if existing > 0 then
    raise exception 'Account already has % fasts', existing using errcode = 'check_violation';
  end if;

  insert into fasts (user_id, plan_id, goal_minutes, start_at, ended_at, status, mood, energy, note)
  select
    target_user,
    row ->> 'planId',
    (row ->> 'goalMinutes')::integer,
    (row ->> 'startAt')::timestamptz,
    nullif(row ->> 'endedAt', '')::timestamptz,
    row ->> 'status',
    nullif(row ->> 'mood', '')::integer,
    nullif(row ->> 'energy', '')::integer,
    nullif(row ->> 'note', '')
  from jsonb_array_elements(coalesce(payload -> 'fasts', '[]'::jsonb)) as row;
  get diagnostics fasts_in = row_count;

  insert into weight_entries (user_id, measured_on, grams)
  select target_user, (row ->> 'measuredOn')::date, (row ->> 'grams')::integer
  from jsonb_array_elements(coalesce(payload -> 'weightEntries', '[]'::jsonb)) as row
  on conflict (user_id, measured_on) do nothing;
  get diagnostics weights_in = row_count;

  insert into water_entries (user_id, logged_at, ml)
  select target_user, (row ->> 'loggedAt')::timestamptz, (row ->> 'ml')::integer
  from jsonb_array_elements(coalesce(payload -> 'waterEntries', '[]'::jsonb)) as row;
  get diagnostics water_in = row_count;

  insert into day_notes (user_id, day, mood, energy, note)
  select
    target_user,
    (row ->> 'day')::date,
    nullif(row ->> 'mood', '')::integer,
    nullif(row ->> 'energy', '')::integer,
    nullif(row ->> 'note', '')
  from jsonb_array_elements(coalesce(payload -> 'dayNotes', '[]'::jsonb)) as row
  on conflict (user_id, day) do nothing;
  get diagnostics notes_in = row_count;

  insert into reminders (user_id, local_time, weekdays, enabled)
  select
    target_user,
    (row ->> 'localTime')::time,
    (select array_agg(value::smallint) from jsonb_array_elements_text(row -> 'weekdays') as value),
    (row ->> 'enabled')::boolean
  from jsonb_array_elements(coalesce(payload -> 'reminders', '[]'::jsonb)) as row;
  get diagnostics reminders_in = row_count;

  /*
   * Activities, each with its nested schedules.
   *
   * A loop rather than a set-based insert, because each schedule needs the id of the activity row just
   * created and the export deliberately carries no database ids — which is what lets a file be imported into
   * a different account without collisions.
   *
   * The 20-activity trigger still applies. An import of a file with more than twenty will fail the whole
   * transaction, which is correct: silently dropping the twenty-first would be a worse answer than refusing.
   */
  for item in select * from jsonb_array_elements(coalesce(payload -> 'activities', '[]'::jsonb))
  loop
    insert into activities (user_id, type_key, custom_label, duration_minutes, notify_end, enabled)
    values (
      target_user,
      nullif(item ->> 'typeKey', ''),
      nullif(item ->> 'customLabel', ''),
      (item ->> 'durationMinutes')::integer,
      coalesce((item ->> 'notifyEnd')::boolean, false),
      coalesce((item ->> 'enabled')::boolean, true)
    )
    returning id into new_activity;

    activities_in := activities_in + 1;

    for schedule in
      select * from jsonb_array_elements(coalesce(item -> 'schedules', '[]'::jsonb))
    loop
      -- `user_id` is omitted: the before-insert trigger takes it from the parent activity, and that is the
      -- only writer that should ever set it.
      insert into activity_schedules (
        activity_id, kind, local_time, window_start, window_end, interval_minutes, weekdays, enabled
      )
      values (
        new_activity,
        schedule ->> 'kind',
        nullif(schedule ->> 'localTime', '')::time,
        nullif(schedule ->> 'windowStart', '')::time,
        nullif(schedule ->> 'windowEnd', '')::time,
        nullif(schedule ->> 'intervalMinutes', '')::integer,
        (
          select array_agg(value::smallint)
          from jsonb_array_elements_text(schedule -> 'weekdays') as value
        ),
        coalesce((schedule ->> 'enabled')::boolean, true)
      );
    end loop;
  end loop;

  -- Completions carry no activity_id, deliberately. The column is nullable precisely because history outlives
  -- the activity, and guessing which imported activity an old completion belonged to would be inventing a
  -- link the file does not contain.
  insert into activity_log (user_id, activity_id, label, type_key, occurred_at, minutes, source, note)
  select
    target_user,
    null,
    row ->> 'label',
    nullif(row ->> 'typeKey', ''),
    (row ->> 'occurredAt')::timestamptz,
    nullif(row ->> 'minutes', '')::integer,
    'manual',
    nullif(row ->> 'note', '')
  from jsonb_array_elements(coalesce(payload -> 'activityLog', '[]'::jsonb)) as row;
  get diagnostics log_in = row_count;

  if payload -> 'profile' is not null and payload -> 'profile' <> 'null'::jsonb then
    update profiles
    set
      display_name        = coalesce(payload -> 'profile' ->> 'displayName', display_name),
      time_zone           = coalesce(payload -> 'profile' ->> 'timeZone', time_zone),
      weight_unit         = coalesce(payload -> 'profile' ->> 'weightUnit', weight_unit),
      volume_unit         = coalesce(payload -> 'profile' ->> 'volumeUnit', volume_unit),
      theme               = coalesce(payload -> 'profile' ->> 'theme', theme),
      default_plan_id     = coalesce(payload -> 'profile' ->> 'defaultPlanId', default_plan_id),
      custom_goal_minutes = coalesce((payload -> 'profile' ->> 'customGoalMinutes')::integer, custom_goal_minutes),
      water_goal_ml       = coalesce((payload -> 'profile' ->> 'waterGoalMl')::integer, water_goal_ml),
      notify_goal         = coalesce((payload -> 'profile' ->> 'notifyGoal')::boolean, notify_goal),
      notify_stages       = coalesce((payload -> 'profile' ->> 'notifyStages')::boolean, notify_stages),
      notify_hour_before  = coalesce((payload -> 'profile' ->> 'notifyHourBefore')::boolean, notify_hour_before),
      notify_activities   = coalesce((payload -> 'profile' ->> 'notifyActivities')::boolean, notify_activities)
    where id = target_user;
  end if;

  return jsonb_build_object(
    'fasts', fasts_in,
    'weightEntries', weights_in,
    'waterEntries', water_in,
    'dayNotes', notes_in,
    'reminders', reminders_in,
    'activities', activities_in,
    'activityLog', log_in
  );
end;
$$;

revoke all on function public.import_fastr_export(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_fastr_export(uuid, jsonb) to service_role;

-- The deletion-proof view, extended. It exists so a test can assert that deleting an auth user removes
-- everything, without the table list being hardcoded in two places — which means a new table missing from
-- here is a cascade nobody checked.
--
-- Dropped and recreated rather than replaced: `create or replace view` can add columns at the end but cannot
-- insert them in the middle, and fails with "cannot change name of view column". The new counts belong next to
-- the other user tables rather than tacked on after `profiles`, so the view goes.
drop view if exists public.fastr_user_row_counts;

create view public.fastr_user_row_counts as
select
  u.id as user_id,
  (select count(*) from fasts where user_id = u.id) as fasts,
  (select count(*) from weight_entries where user_id = u.id) as weight_entries,
  (select count(*) from water_entries where user_id = u.id) as water_entries,
  (select count(*) from day_notes where user_id = u.id) as day_notes,
  (select count(*) from push_subscriptions where user_id = u.id) as push_subscriptions,
  (select count(*) from reminders where user_id = u.id) as reminders,
  (select count(*) from notifications where user_id = u.id) as notifications,
  (select count(*) from activities where user_id = u.id) as activities,
  (select count(*) from activity_schedules where user_id = u.id) as activity_schedules,
  (select count(*) from activity_log where user_id = u.id) as activity_log,
  (select count(*) from profiles where id = u.id) as profiles
from auth.users u;

revoke all on public.fastr_user_row_counts from public, anon, authenticated;
grant select on public.fastr_user_row_counts to service_role;
