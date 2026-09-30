-- Fastr core schema: profiles and fasts.
--
-- There is no application server in this architecture, so this file is where the business rules
-- live. The browser talks to Postgres directly with a published anon key, which means anything not
-- enforced here is not enforced at all. Two things follow from that, and they are the reason this
-- migration is longer than a table definition needs to be:
--
--   1. Every rule that matters is a constraint, not a check in the client.
--   2. Row Level Security is on from the first table, with no window in which it is off.

create extension if not exists btree_gist;  -- needed by the exclusion constraint on fasts

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- One row per account, created by a trigger on auth.users rather than by the client, so a signed-in
-- user always has somewhere for their settings to live.

create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  display_name        text        not null check (char_length(display_name) between 1 and 40),

  -- An IANA name such as 'Africa/Nairobi', never an offset. Reminder scheduling converts through
  -- this zone twice (Req 8.4), and a stored offset cannot survive a daylight saving change.
  time_zone           text        not null default 'UTC',

  weight_unit         text        not null default 'kg'     check (weight_unit in ('kg', 'lb')),
  volume_unit         text        not null default 'ml'     check (volume_unit in ('ml', 'floz')),
  theme               text        not null default 'system' check (theme in ('light', 'dark', 'system')),

  default_plan_id     text        not null default '16:8',

  -- Set only for the custom plan. Req 4.5: 1 to 72 hours in quarter-hour steps.
  custom_goal_minutes integer     check (
                        custom_goal_minutes between 60 and 4320
                        and custom_goal_minutes % 15 = 0
                      ),

  water_goal_ml       integer     not null default 2000 check (water_goal_ml between 100 and 10000),

  notify_goal         boolean     not null default true,
  notify_stages       boolean     not null default false,
  notify_hour_before  boolean     not null default false,

  -- Null means the health notice has not been acknowledged and the app stays gated (Req 1.5, 17.1).
  health_notice_at    timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on column public.profiles.custom_goal_minutes is
  'Fast length for the custom plan only. Null for every fixed plan.';

-- ---------------------------------------------------------------------------
-- fasts
-- ---------------------------------------------------------------------------

create table public.fasts (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  plan_id      text        not null,

  -- Req 17.3. A single fast may not exceed 72 hours, and the app must not be able to ask for one.
  goal_minutes integer     not null check (goal_minutes between 60 and 4320),

  start_at     timestamptz not null,
  ended_at     timestamptz,
  status       text        not null check (status in ('active', 'completed', 'ended_early')),

  mood         smallint    check (mood between 1 and 5),
  energy       smallint    check (energy between 1 and 5),
  note         text        check (char_length(note) <= 1000),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- An active fast has no end. A finished one has an end after its start. Stating it as one
  -- constraint means the two columns cannot disagree with the status.
  constraint fast_end_matches_status check (
    (status =  'active' and ended_at is null) or
    (status <> 'active' and ended_at is not null and ended_at > start_at)
  ),

  -- Req 5.2 and 5.9 in a single rule. An active fast occupies [start_at, infinity), so two active
  -- fasts always overlap and are rejected, and no finished fast may overlap another either.
  --
  -- This is the piece doing the most work in the schema. Done in the client it would be a
  -- read-then-write, which is exactly the pattern that loses a race between two devices.
  constraint fasts_no_overlap exclude using gist (
    user_id with =,
    tstzrange(start_at, coalesce(ended_at, 'infinity'::timestamptz), '[)') with &&
  )
);

-- Req 5.2 again, and redundant in practice: an attempt to start a second active fast is caught by
-- fasts_no_overlap above, because two [start, infinity) ranges always intersect. Verified, rather
-- than assumed — the probe in supabase/tests/manual names the constraint that fires, and it is
-- always the exclusion one.
--
-- Kept anyway, for two reasons: it is a partial index of one row per user, so it costs almost
-- nothing, and it states the rule in a form a reader recognises immediately. If fasts_no_overlap is
-- ever relaxed, this is what still holds Req 5.2.
create unique index fasts_one_active_per_user
  on public.fasts (user_id)
  where status = 'active';

create index fasts_user_recent on public.fasts (user_id, start_at desc);
create index fasts_user_ended  on public.fasts (user_id, ended_at desc) where ended_at is not null;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger fasts_touch_updated_at
  before update on public.fasts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Profile creation on sign-up
-- ---------------------------------------------------------------------------
-- Req 1.2 and 1.6. The display name and time zone arrive in the invite or sign-up metadata. Doing
-- this in the client would leave a window where a signed-in user has no profile row, and every
-- screen would need to handle it.
--
-- security definer because it writes to public.profiles as the trigger owner, and the search_path
-- is pinned so the function cannot be redirected by a caller's own schema.

create or replace function public.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, time_zone)
  values (
    new.id,
    -- Fall back to the local part of the email, so a profile always has a usable name.
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1)
    ),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'time_zone'), ''), 'UTC')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_profile_for_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Req 18.1. This is the security boundary of the whole application.
--
-- Note that every `for update` policy carries both `using` and `with check`. With only `using`, a
-- user could update their own row and set user_id to somebody else's, handing their data away. It is
-- an odd attack and a trivial bug, and the RLS test suite asserts it is closed.

alter table public.profiles enable row level security;
alter table public.fasts    enable row level security;

-- profiles gets no insert or delete policy: rows are created by the trigger above and removed by the
-- cascade from auth.users, so the client has no business doing either.
create policy profiles_select on public.profiles
  for select using (id = auth.uid());

create policy profiles_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy fasts_select on public.fasts
  for select using (user_id = auth.uid());

create policy fasts_insert on public.fasts
  for insert with check (user_id = auth.uid());

create policy fasts_update on public.fasts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy fasts_delete on public.fasts
  for delete using (user_id = auth.uid());
