-- GENERATED FILE — do not edit by hand.
--
-- Written by `npm run gen:activities` from packages/shared/src/activities.ts, which is the source of
-- truth for the preset activity list (Requirement 1.2). Edit the TypeScript and re-run the generator;
-- CI fails if this file does not match.
--
-- Postgres needs its own copy so that `activities.type_key` can be a foreign key against it. Without
-- that, a mistyped key becomes an activity with no label and no icon, and the notification composer
-- has no copy for it.

create table if not exists public.activity_types (
  key             text    primary key,
  label           text    not null,
  icon            text    not null,
  default_minutes integer not null check (default_minutes between 1 and 480),
  -- 'minutes' for anything you spend time on; 'ml' for water, whose completions are volumes and are
  -- written to water_entries rather than activity_log.
  unit            text    not null check (unit in ('minutes', 'ml')),
  sort_order      integer not null unique
);

-- Reference data rather than user data, so this is the second table in `public` whose policy is not
-- scoped to `auth.uid()` — the first being fasting_stages, for the same reason. It holds nothing
-- private: the same rows ship inside the web bundle. RLS stays enabled because
-- `scripts/check-rls.mjs` requires it of every table, and an exception carved out for one table is
-- an exception somebody later widens.
alter table public.activity_types enable row level security;

drop policy if exists activity_types_select on public.activity_types;
create policy activity_types_select on public.activity_types
  for select using (true);

-- Replace rather than upsert, so a type removed from the TypeScript list disappears here too. An
-- upsert would leave it behind forever. Re-runnable, which is what lets this file keep a fixed name.
--
-- `delete` rather than `truncate`: activities.type_key references this table, and truncate on a
-- referenced table fails unless cascaded — and cascading would delete the user's activities. A
-- delete fails loudly against a type still in use instead, which is the correct outcome: removing a
-- type somebody is using is a data decision, not a code change.
delete from public.activity_types;

insert into public.activity_types (key, label, icon, default_minutes, unit, sort_order) values
  ('walk', 'Walk', '🚶', 20, 'minutes', 1),
  ('run', 'Run', '🏃', 30, 'minutes', 2),
  ('cycle', 'Cycle', '🚴', 45, 'minutes', 3),
  ('swim', 'Swim', '🏊', 45, 'minutes', 4),
  ('stretch', 'Stretch', '🧘', 10, 'minutes', 5),
  ('strength', 'Strength', '🏋️', 40, 'minutes', 6),
  ('water', 'Water', '💧', 1, 'ml', 7);
