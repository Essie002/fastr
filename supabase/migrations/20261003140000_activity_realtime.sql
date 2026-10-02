-- Cross-device liveness for activities and their schedules.
--
-- Enabling Realtime in config.toml starts the service but publishes nothing: the `supabase_realtime`
-- publication is empty until tables are added to it, and a subscription to an unpublished table reports
-- SUBSCRIBED and then delivers nothing for ever. That exact failure cost a debugging session on `fasts`
-- (see 20260930200000), so it is worth stating again rather than rediscovering.
--
-- Activities and schedules are published because editing them on a laptop should update the phone that is
-- about to be reminded by them. `activity_log` is not: a completion is written by the device in the user's
-- hand, and the existing refetch-on-focus is enough for the other one.

alter publication supabase_realtime add table public.activities;
alter publication supabase_realtime add table public.activity_schedules;

-- `replica identity full` so DELETE and UPDATE payloads carry the old row. Without it a delete arrives with
-- only the primary key, which is enough to drop a row from a list and not enough to know which activity it
-- belonged to — and a schedule's parent is exactly what a client needs in order to update the right entry.
alter table public.activities replica identity full;
alter table public.activity_schedules replica identity full;
