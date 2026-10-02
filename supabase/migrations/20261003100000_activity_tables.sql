-- Activities, their schedules, and the record of what was actually done. Requirements 1, 2, 3, 5.
--
-- Three tables rather than one, and the split is load-bearing.
--
-- A schedule is separate from an activity because there are two schedule *shapes* — a wall-clock time on
-- chosen weekdays, and a repeating interval inside a daily window — and each needs its own columns. Hanging
-- both shapes' columns off `activities` would leave half of them null for every row, and a CHECK constraint
-- that has to reason about which half applies is a constraint nobody can read or trust. Separate, each shape
-- is required-or-forbidden in one expression (see `schedule_shape`). It also means one activity can have
-- several schedules, so "swim Tuesday 07:00 and Saturday 09:00" is one activity rather than two
-- (Requirement 2.3).
--
-- The log is separate because it outlives the schedule. Deleting an activity does not unmake the swim.

-- ---------------------------------------------------------------------------
-- Activities
-- ---------------------------------------------------------------------------

create table public.activities (
  id       uuid not null primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users (id) on delete cascade,

  -- A foreign key rather than free text, so a typo cannot produce an activity whose type the
  -- notification composer has no copy for. Null for a custom activity, which has no preset.
  type_key text references public.activity_types (key),

  -- Set only for a custom activity. Trimmed length, because a label of three spaces passes a naive
  -- length check and then renders as nothing at all in a notification.
  custom_label text check (
    custom_label is null or char_length(btrim(custom_label)) between 1 and 40
  ),

  duration_minutes integer not null check (duration_minutes between 1 and 480),

  -- Requirement 4.3. Off by default, and that is the decision rather than an accident of defaults:
  -- a second notification for every activity is how a user ends up disabling notifications entirely,
  -- which would cost them their fasting alerts too.
  notify_end boolean not null default false,

  enabled    boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Exactly one naming route. Without this a row can be both a preset and a custom label, or neither,
  -- and what the user sees becomes a coin toss between the two.
  constraint activity_named_once check (
    (type_key is not null and custom_label is null) or
    (type_key is null and custom_label is not null)
  )
);

create index activities_user on public.activities (user_id);

create trigger activities_touch_updated_at
  before update on public.activities
  for each row execute function public.touch_updated_at();

/*
 * Requirement 1.7. At most 20 activities per user.
 *
 * A trigger rather than a CHECK, because a CHECK cannot count other rows. Enforced here rather than only in
 * the client, because a limit that lives in the client is not a limit — the table is reachable directly with
 * the anon key, which is the whole premise of this architecture.
 *
 * `count(*)` under the default isolation level can race: two concurrent inserts at 20 can both see 20 and
 * both succeed. That is accepted. The limit exists to stop a runaway UI or a bored user, not to defend a
 * boundary, and the cost of being correct here is serialising every insert against a user's own rows.
 */
create or replace function public.enforce_activity_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing integer;
begin
  select count(*) into existing from activities where user_id = new.user_id;

  if existing >= 20 then
    -- A message the UI can show verbatim. The hint is separate so a log reader sees the number.
    raise exception 'You can have at most 20 activities. Delete one to add another.'
      using errcode = 'check_violation', hint = format('user already has %s activities', existing);
  end if;

  return new;
end;
$$;

create trigger activities_limit
  before insert on public.activities
  for each row execute function public.enforce_activity_limit();

-- ---------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------

create table public.activity_schedules (
  id          uuid not null primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,

  -- Denormalised from the parent activity, and it earns its place twice: the RLS policy becomes
  -- `user_id = auth.uid()` with no subquery, and the scheduling function joins straight to profiles for
  -- the time zone. The trigger below sets it, so the client never supplies it — without that this column
  -- would be a hole through which a row could be attributed to somebody else.
  user_id uuid not null references auth.users (id) on delete cascade,

  kind text not null check (kind in ('at', 'every')),

  -- 0 is Sunday, matching `extract(dow from ...)` and the existing reminders table. Picking the other
  -- convention would mean translating on every read, and the translation is where off-by-one lives.
  weekdays smallint[] not null check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),

  -- kind = 'at'
  local_time time,

  -- kind = 'every'
  window_start     time,
  window_end       time,
  interval_minutes integer check (interval_minutes between 15 and 720),

  enabled    boolean     not null default true,
  created_at timestamptz not null default now(),

  /*
   * Each shape's columns required, the other shape's forbidden. This is the constraint the two-table
   * split exists to make writeable.
   *
   * The last clause is Requirement 3.2: a window shorter than its interval can fire only once, which is
   * not the schedule the user meant when they asked for a repeat. Refused at write time rather than
   * silently degraded into a single daily reminder.
   */
  constraint schedule_shape check (
    (
      kind = 'at'
      and local_time is not null
      and window_start is null
      and window_end is null
      and interval_minutes is null
    )
    or (
      kind = 'every'
      and local_time is null
      and window_start is not null
      and window_end is not null
      and interval_minutes is not null
      and window_end > window_start
      and (extract(epoch from (window_end - window_start)) / 60) >= interval_minutes
    )
  )
);

create index activity_schedules_activity on public.activity_schedules (activity_id);

-- Covers the scheduling function's only query shape: every enabled schedule, joined to its activity.
create index activity_schedules_enabled on public.activity_schedules (user_id) where enabled;

/*
 * Takes `user_id` from the parent activity instead of the client.
 *
 * The denormalised column is what makes the RLS policy cheap, which means it is also what RLS trusts. If a
 * client could set it, it could file a schedule under another user's id — and that row would then be
 * invisible to its real owner and would queue notifications attributed to someone else.
 */
create or replace function public.set_activity_schedule_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select user_id into new.user_id from activities where id = new.activity_id;

  if new.user_id is null then
    raise exception 'No such activity: %', new.activity_id using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create trigger activity_schedules_set_user
  before insert or update of activity_id on public.activity_schedules
  for each row execute function public.set_activity_schedule_user();

-- ---------------------------------------------------------------------------
-- The log
-- ---------------------------------------------------------------------------

create table public.activity_log (
  id      uuid not null primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- `set null` rather than `cascade`, per Requirement 1.6: deleting an activity is a statement about
  -- the schedule, not a claim that the swim never happened.
  activity_id uuid references public.activities (id) on delete set null,

  -- Snapshotted at write time, because `activity_id` can become null and a history row still has to
  -- render. Joining for the label would also mean renaming an activity retitles history retroactively,
  -- and a log is a record of what was true then.
  label    text not null check (char_length(btrim(label)) between 1 and 40),
  type_key text references public.activity_types (key),

  occurred_at timestamptz not null,

  -- Nullable: an unplanned walk logged after the fact may have no duration worth claiming, and a
  -- required number would be invented. 1440 is a day, which is the point past which this is not a
  -- duration but a data entry error.
  minutes integer check (minutes between 1 and 1440),

  /*
   * Requirement 5.3. 'strava' exists from the start, before any integration does.
   *
   * The column is cheap now and expensive later: adding it after the fact means every historical row
   * needs a value, and the only honest value is a guess. With it here, adding an integration is a new
   * writer rather than a migration of data nobody can verify.
   */
  source      text not null default 'manual' check (source in ('manual', 'strava')),
  external_id text,

  note       text check (note is null or char_length(note) <= 280),
  created_at timestamptz not null default now(),

  constraint external_id_needs_source check (external_id is null or source <> 'manual')
);

create index activity_log_user_occurred on public.activity_log (user_id, occurred_at desc);

-- Idempotency for a future import: pulling the same third-party activity twice must not double it.
-- Partial, because every hand-recorded row has a null external_id and they must not collide.
create unique index activity_log_external
  on public.activity_log (user_id, source, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
--
-- The uniform owner-scoped four, on every table. This is the security boundary for the whole app, not a
-- defence in depth: the browser holds the anon key and talks to Postgres directly, so a table without
-- these is a table any signed-in user can read in full. `npm run check:rls` fails the build if one is
-- missing, which is why they ship in the same migration as the tables.

alter table public.activities enable row level security;

create policy activities_select on public.activities
  for select using (user_id = auth.uid());
create policy activities_insert on public.activities
  for insert with check (user_id = auth.uid());
create policy activities_update on public.activities
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy activities_delete on public.activities
  for delete using (user_id = auth.uid());

alter table public.activity_schedules enable row level security;

-- `using` on the denormalised column, which the trigger above owns. The insert policy still checks it
-- because policies run before the before-insert trigger has set it on a direct insert attempt — the
-- trigger is what makes it correct, the policy is what makes it safe.
create policy activity_schedules_select on public.activity_schedules
  for select using (user_id = auth.uid());
create policy activity_schedules_insert on public.activity_schedules
  for insert with check (
    exists (
      select 1 from public.activities a
       where a.id = activity_id and a.user_id = auth.uid()
    )
  );
create policy activity_schedules_update on public.activity_schedules
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy activity_schedules_delete on public.activity_schedules
  for delete using (user_id = auth.uid());

alter table public.activity_log enable row level security;

create policy activity_log_select on public.activity_log
  for select using (user_id = auth.uid());
create policy activity_log_insert on public.activity_log
  for insert with check (user_id = auth.uid());
create policy activity_log_update on public.activity_log
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy activity_log_delete on public.activity_log
  for delete using (user_id = auth.uid());
