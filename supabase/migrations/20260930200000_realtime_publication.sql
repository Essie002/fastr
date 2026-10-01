-- Letting Realtime publish changes to fasts. Requirement 5.6.
--
-- Supabase creates the `supabase_realtime` publication empty, and a `postgres_changes` subscription to a table that is
-- not in it never receives anything. The client reports CHANNEL_ERROR and the app falls back to refetching on focus,
-- which works — so the feature appears to be "just a bit laggy" rather than entirely absent. Found by running the app
-- and seeing the degraded banner that was supposed to be the rare case.
--
-- Only `fasts`. Requirement 5.6 is about a fast started or ended on one device showing up on another, and that is the
-- only table where seconds matter. Water, weight and notes are edited in one place at a time and arrive on the next
-- refetch, so publishing them would be a socket's worth of traffic for no benefit.
--
-- Row Level Security still applies to what a subscriber receives: being in the publication decides whether changes are
-- broadcast at all, not who may see them.

do $$
begin
  -- Guarded so the migration is idempotent: adding a table twice is an error, and `db reset` replays every migration.
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'fasts'
  ) then
    alter publication supabase_realtime add table public.fasts;
  end if;
end;
$$;

-- `replica identity full` so an update's *old* values travel with the event.
--
-- The default, `default`, sends only the primary key for the old row. The app only invalidates its queries on an event
-- rather than applying the payload, so it would work either way — but a filtered subscription (`user_id=eq...`) is
-- evaluated against the old row too for updates, and with only a key to look at, Realtime cannot tell whether an update
-- matches the filter. The symptom is updates silently not arriving while inserts do.
alter table public.fasts replica identity full;
