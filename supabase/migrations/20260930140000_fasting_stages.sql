-- GENERATED FILE — do not edit by hand.
--
-- Written by `npm run gen:stages` from packages/shared/src/stages.ts, which is the source of truth
-- for the stage list (Requirement 6.6). Edit the TypeScript and re-run the generator; CI fails if
-- this file does not match.
--
-- Postgres needs its own copy because the notification trigger works out which stage alerts a fast
-- should queue, and it cannot import TypeScript.

create table if not exists public.fasting_stages (
  key         text     primary key,
  at_minutes  integer  not null unique check (at_minutes >= 0),
  name        text     not null,
  description text     not null
);

-- Reference data, not user data, so this is the one table in `public` whose policy is not scoped to
-- `auth.uid()`. It holds nothing private: the same eight rows ship inside the web bundle. RLS is
-- still enabled, because `scripts/check-rls.mjs` requires it of every table and an exception carved
-- out for one table is an exception somebody later widens.
alter table public.fasting_stages enable row level security;

drop policy if exists fasting_stages_select on public.fasting_stages;
create policy fasting_stages_select on public.fasting_stages
  for select using (true);

-- Replace rather than upsert: a stage removed from the TypeScript list must disappear here too, and
-- an upsert would leave it behind forever. Safe to re-run, which is what lets this file keep a fixed
-- name instead of accumulating one migration per edit.
truncate table public.fasting_stages;

insert into public.fasting_stages (key, at_minutes, name, description) values
  ('blood_sugar_rising', 0, 'Blood sugar rising', 'Your last meal is still being digested and blood sugar is up. The body is running on what you just ate.'),
  ('blood_sugar_falling', 120, 'Blood sugar falling', 'Digestion is finishing and blood sugar typically starts to come back down. Insulin usually falls with it.'),
  ('blood_sugar_normal', 300, 'Blood sugar normal', 'Blood sugar is generally back to its baseline. The body is drawing on glycogen stored in the liver for energy.'),
  ('fat_burning', 720, 'Fat burning begins', 'Liver glycogen is often running low by around this point, and the body typically turns more to stored fat for fuel.'),
  ('ketosis', 1080, 'Ketosis', 'The liver may start producing ketones from fat in useful amounts. How quickly this happens varies a lot between people.'),
  ('autophagy', 1440, 'Autophagy', 'Cellular clean-up, where cells recycle worn-out parts, is thought to increase around this point. Most of the evidence comes from animal studies, so treat the timing loosely.'),
  ('growth_hormone', 2880, 'Growth hormone rising', 'Growth hormone has been measured rising substantially in fasts of around this length, though the studies are small. This is deep into extended-fast territory.'),
  ('immune_reset', 4320, 'Immune reset', 'Some research points to immune cell renewal around three days. A fast this long is not something to attempt without medical supervision.');
