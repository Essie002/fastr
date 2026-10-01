-- Importing an export, as one transaction. Requirement 16.3.
--
-- A plpgsql function rather than a sequence of calls from the Edge Function, for one reason: a function body is a
-- single transaction, so if the overlap constraint rejects the fortieth fast, the first thirty-nine are rolled back
-- too. Done as separate inserts over HTTP, a failure halfway leaves a half-imported history that the user cannot
-- see into and cannot safely retry.

create or replace function public.import_fastr_export(target_user uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fasts_in    integer := 0;
  weights_in  integer := 0;
  water_in    integer := 0;
  notes_in    integer := 0;
  reminders_in integer := 0;
begin
  -- Checked again inside the transaction. The Edge Function checks first for a readable message; this is what makes
  -- it true when two imports arrive at once.
  if exists (select 1 from fasts where user_id = target_user) then
    raise exception 'account already has fasts';
  end if;

  insert into fasts (user_id, plan_id, goal_minutes, start_at, ended_at, status, mood, energy, note)
  select
    target_user,
    item ->> 'planId',
    (item ->> 'goalMinutes')::integer,
    (item ->> 'startAt')::timestamptz,
    nullif(item ->> 'endedAt', '')::timestamptz,
    item ->> 'status',
    nullif(item ->> 'mood', '')::smallint,
    nullif(item ->> 'energy', '')::smallint,
    nullif(item ->> 'note', '')
  from jsonb_array_elements(coalesce(payload -> 'fasts', '[]'::jsonb)) as item
  -- An export may contain the fast that was running when it was taken. Importing it as active would collide with
  -- the one-active-fast rule the moment the user starts another, so only finished fasts come across.
  where item ->> 'status' <> 'active';
  get diagnostics fasts_in = row_count;

  insert into weight_entries (user_id, measured_on, grams)
  select target_user, (item ->> 'measuredOn')::date, (item ->> 'grams')::integer
  from jsonb_array_elements(coalesce(payload -> 'weightEntries', '[]'::jsonb)) as item
  -- One reading per day is the rule; an export cannot contain two, but a hand-edited file could.
  on conflict (user_id, measured_on) do nothing;
  get diagnostics weights_in = row_count;

  insert into water_entries (user_id, logged_at, ml)
  select target_user, (item ->> 'loggedAt')::timestamptz, (item ->> 'ml')::integer
  from jsonb_array_elements(coalesce(payload -> 'waterEntries', '[]'::jsonb)) as item;
  get diagnostics water_in = row_count;

  insert into day_notes (user_id, day, mood, energy, note)
  select
    target_user,
    (item ->> 'day')::date,
    nullif(item ->> 'mood', '')::smallint,
    nullif(item ->> 'energy', '')::smallint,
    nullif(item ->> 'note', '')
  from jsonb_array_elements(coalesce(payload -> 'dayNotes', '[]'::jsonb)) as item
  on conflict (user_id, day) do nothing;
  get diagnostics notes_in = row_count;

  insert into reminders (user_id, local_time, weekdays, enabled)
  select
    target_user,
    (item ->> 'localTime')::time,
    -- jsonb numbers come out as text, so each element is cast individually rather than the array as a whole.
    (select array_agg(value::text::smallint) from jsonb_array_elements(item -> 'weekdays') as value),
    coalesce((item ->> 'enabled')::boolean, true)
  from jsonb_array_elements(coalesce(payload -> 'reminders', '[]'::jsonb)) as item;
  get diagnostics reminders_in = row_count;

  -- Settings last, and only the fields an export carries. Deliberately not the health acknowledgement: that is a
  -- statement this person read a notice, and it should not arrive in a file.
  if payload -> 'profile' is not null and payload -> 'profile' <> 'null'::jsonb then
    update profiles set
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
      notify_hour_before  = coalesce((payload -> 'profile' ->> 'notifyHourBefore')::boolean, notify_hour_before)
    where id = target_user;
  end if;

  return jsonb_build_object(
    'fasts', fasts_in,
    'weightEntries', weights_in,
    'waterEntries', water_in,
    'dayNotes', notes_in,
    'reminders', reminders_in
  );
end;
$$;

revoke all on function public.import_fastr_export(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_fastr_export(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Account deletion. Requirement 3.3.
-- ---------------------------------------------------------------------------
-- Deleting an auth user needs the service role, so the Edge Function does it through the admin API. Every table in
-- `public` references auth.users with `on delete cascade`, so one call removes everything — this view exists only so
-- a test can assert that, without hardcoding the table list in two places.

create or replace view public.fastr_user_row_counts as
select
  u.id as user_id,
  (select count(*) from fasts              where user_id = u.id) as fasts,
  (select count(*) from weight_entries     where user_id = u.id) as weight_entries,
  (select count(*) from water_entries      where user_id = u.id) as water_entries,
  (select count(*) from day_notes          where user_id = u.id) as day_notes,
  (select count(*) from push_subscriptions where user_id = u.id) as push_subscriptions,
  (select count(*) from reminders          where user_id = u.id) as reminders,
  (select count(*) from notifications      where user_id = u.id) as notifications,
  (select count(*) from profiles           where id      = u.id) as profiles
from auth.users u;

revoke all on public.fastr_user_row_counts from public, anon, authenticated;
grant select on public.fastr_user_row_counts to service_role;
