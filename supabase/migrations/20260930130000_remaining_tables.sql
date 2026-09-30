-- The rest of the schema: weight, water, day notes, push subscriptions, reminders, and the
-- notification queue.
--
-- Same principles as the core migration. Every range and length the app validates in Zod is
-- repeated here as a constraint, because the anon key reaches Postgres directly and a rule that
-- lives only in the browser is not a rule. RLS is enabled in the same migration that creates each
-- table, so there is no window in which a table exists unprotected.

-- ---------------------------------------------------------------------------
-- weight_entries
-- ---------------------------------------------------------------------------
-- Req 11. Stored as grams, converted only for display, so switching between kg and lb re-renders
-- the same history rather than reinterpreting it.

create table public.weight_entries (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  measured_on date        not null,

  -- Req 11.4: 20 kg to 400 kg. Outside this it is a typo or a different unit, and either way
  -- storing it would wreck the chart's scale.
  grams       integer     not null check (grams between 20000 and 400000),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One weight per day. A second reading for the same day is a correction, not a new fact, so the
  -- app upserts on this rather than accumulating rows that make the chart zigzag.
  unique (user_id, measured_on)
);

create index weight_user_date on public.weight_entries (user_id, measured_on desc);

-- ---------------------------------------------------------------------------
-- water_entries
-- ---------------------------------------------------------------------------
-- Req 12. An instant rather than a date, because "today" is the user's local calendar day and the
-- conversion has to happen at read time against their current time zone.

create table public.water_entries (
  id        uuid        primary key default gen_random_uuid(),
  user_id   uuid        not null references auth.users (id) on delete cascade,
  logged_at timestamptz not null default now(),
  ml        integer     not null check (ml between 1 and 5000),
  created_at timestamptz not null default now()
);

create index water_user_logged on public.water_entries (user_id, logged_at desc);

-- ---------------------------------------------------------------------------
-- day_notes
-- ---------------------------------------------------------------------------
-- Req 13. Mood and energy for a day rather than for a fast. Both exist: a note attached to a fast
-- describes that fast, and this describes a day the user may not have fasted on at all.

create table public.day_notes (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  day        date        not null,
  mood       smallint    check (mood between 1 and 5),
  energy     smallint    check (energy between 1 and 5),
  note       text        check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------
-- Req 7. One row per device, not per user: a user with a phone and a laptop has two, and a goal
-- notification goes to both.

create table public.push_subscriptions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,

  -- The push service's URL for this device. Unique globally rather than per user, because a browser
  -- re-subscribing produces the same endpoint and it must update the existing row rather than
  -- create a duplicate that gets notified twice.
  endpoint   text        not null unique,

  -- The client's public key and auth secret, used to encrypt the payload. Requirement 18.9: these
  -- must never be logged.
  p256dh     text        not null,
  auth       text        not null,

  user_agent text        check (char_length(user_agent) <= 500),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,

  -- Incremented when a push service answers 429 or 5xx, so a persistently broken subscription is
  -- visible rather than silently swallowing notifications. A 404 or 410 deletes the row instead.
  failures   integer     not null default 0
);

create index push_user on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- reminders
-- ---------------------------------------------------------------------------
-- Req 8. A wall-clock time plus the days it applies to, resolved against the profile's zone at send
-- time. Storing an instant instead would drift by an hour twice a year.

create table public.reminders (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  local_time time        not null,

  -- 0 is Sunday, matching Postgres `extract(dow from ...)` so the hourly job can compare directly
  -- without a mapping table nobody remembers the direction of.
  --
  -- `cardinality`, not `array_length`. For an empty array `array_length(weekdays, 1)` returns NULL,
  -- `NULL between 1 and 7` is NULL, and a CHECK constraint accepts NULL rather than rejecting it — so
  -- the obvious spelling of this rule lets `'{}'` straight through. A reminder with no days would
  -- then sit in the table firing never, looking like a bug in the scheduler. `cardinality` returns 0
  -- for an empty array, which fails the comparison properly. Found by the test, not by review.
  weekdays   smallint[]  not null check (
               cardinality(weekdays) between 1 and 7
               and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
             ),

  enabled    boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reminders_enabled on public.reminders (user_id) where enabled;

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
-- Req 7.6 and 7.7. The queue. Rows are written by a trigger on fasts (next migration) and consumed
-- by the send-notifications Edge Function.
--
-- A queue in the database rather than a timer in a browser is the whole reason this app needs a
-- back end: a phone in a pocket cannot wake itself to announce that a fast finished.

create table public.notifications (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,

  -- Cascades, so deleting a fast takes its pending notifications with it and no application code
  -- has to remember. Null for a reminder, which belongs to a schedule rather than to a fast.
  fast_id    uuid        references public.fasts (id) on delete cascade,

  kind       text        not null check (kind in ('goal', 'stage', 'hour_before', 'reminder')),

  -- Set only when kind = 'stage'. Names which stage, so the sender can compose the message from the
  -- shared stage list rather than storing the text.
  stage_key  text,

  due_at     timestamptz not null,

  status     text        not null default 'pending'
               check (status in ('pending', 'sent', 'skipped', 'cancelled')),

  -- When the sender took the row. See the claiming statement in the design: the row is marked sent
  -- before delivery is attempted, choosing a possible miss over a possible duplicate at 3 a.m.
  claimed_at timestamptz,
  sent_at    timestamptz,
  attempts   integer     not null default 0,
  created_at timestamptz not null default now(),

  constraint stage_key_only_for_stage check (
    (kind =  'stage' and stage_key is not null) or
    (kind <> 'stage' and stage_key is null)
  ),

  constraint reminder_has_no_fast check (
    (kind =  'reminder' and fast_id is null) or
    (kind <> 'reminder' and fast_id is not null)
  )
);

-- The sender's only query: pending work, oldest first. Partial, so it stays small forever no matter
-- how many sent rows accumulate behind it.
create index notifications_due on public.notifications (due_at) where status = 'pending';

-- Req 7.7. The same logical notification must not exist twice, so a retried trigger or an edit that
-- reschedules the same fast cannot produce two alerts. Scoped to rows that are still live: a
-- cancelled row must not block a legitimate reschedule.
create unique index notifications_unique_per_fast
  on public.notifications (fast_id, kind, coalesce(stage_key, ''))
  where fast_id is not null and status in ('pending', 'sent');

create index notifications_user on public.notifications (user_id, due_at desc);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create trigger weight_entries_touch_updated_at
  before update on public.weight_entries
  for each row execute function public.touch_updated_at();

create trigger day_notes_touch_updated_at
  before update on public.day_notes
  for each row execute function public.touch_updated_at();

create trigger reminders_touch_updated_at
  before update on public.reminders
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Req 18.1. Same shape on every table: read and write only your own rows. Every `for update` policy
-- carries both `using` and `with check`, so a user cannot update their own row and reassign it to
-- somebody else.

alter table public.weight_entries     enable row level security;
alter table public.water_entries      enable row level security;
alter table public.day_notes          enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminders          enable row level security;
alter table public.notifications      enable row level security;

create policy weight_select on public.weight_entries
  for select using (user_id = auth.uid());
create policy weight_insert on public.weight_entries
  for insert with check (user_id = auth.uid());
create policy weight_update on public.weight_entries
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy weight_delete on public.weight_entries
  for delete using (user_id = auth.uid());

create policy water_select on public.water_entries
  for select using (user_id = auth.uid());
create policy water_insert on public.water_entries
  for insert with check (user_id = auth.uid());
create policy water_update on public.water_entries
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy water_delete on public.water_entries
  for delete using (user_id = auth.uid());

create policy day_notes_select on public.day_notes
  for select using (user_id = auth.uid());
create policy day_notes_insert on public.day_notes
  for insert with check (user_id = auth.uid());
create policy day_notes_update on public.day_notes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy day_notes_delete on public.day_notes
  for delete using (user_id = auth.uid());

create policy push_select on public.push_subscriptions
  for select using (user_id = auth.uid());
create policy push_insert on public.push_subscriptions
  for insert with check (user_id = auth.uid());
create policy push_update on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_delete on public.push_subscriptions
  for delete using (user_id = auth.uid());

create policy reminders_select on public.reminders
  for select using (user_id = auth.uid());
create policy reminders_insert on public.reminders
  for insert with check (user_id = auth.uid());
create policy reminders_update on public.reminders
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy reminders_delete on public.reminders
  for delete using (user_id = auth.uid());

-- notifications is select-only for the client. Useful in settings to show what is queued, and
-- nothing more: rows are written by the trigger and by the sender, both of which run with elevated
-- rights. A client that could insert here could make the server send arbitrary push messages to
-- itself, and a client that could update could mark another user's notification sent.
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());
