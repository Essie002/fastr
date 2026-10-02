-- Moves the notification sender's URL and shared secret out of database settings and into a table.
--
-- Why: `alter database postgres set app.settings.x = ...` — which migration 20260930160000 documents and the README
-- told you to run — is refused on a current hosted Supabase project. Custom GUCs cannot be set even as `postgres`,
-- whether at database or role level, through the SQL editor, the pooler or the management API:
--
--   ERROR: 42501: permission denied to set parameter "app.settings.functions_url"
--
-- The failure mode was quiet, which is the worst part. `cron.schedule` succeeded, the job appeared in `cron.job` and
-- ran every minute, and `current_setting(..., true)` returned null rather than raising — so the job's own
-- `where ... is not null` guard made it a no-op. A healthy-looking schedule that silently sends nothing.
--
-- A table works because it needs no special privilege, reads the same locally and hosted, and can be inspected.
--
-- The secret's protection is schema placement rather than row-level security. PostgREST serves only the schemas in
-- its `db-schemas` list — `public` and `graphql_public` — so nothing in `private` has an HTTP surface at all. RLS
-- would be the wrong tool: it governs which rows a role sees through the API, and the point here is that there is
-- no API. Grants are revoked as well, so a future schema exposure is not immediately a secret leak.

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.app_settings (
  -- One row, enforced. Two rows would make `(select ... from private.app_settings)` non-deterministic, and the
  -- symptom would be a sender that works until someone inserts a second row.
  id boolean primary key default true constraint app_settings_single_row check (id),
  functions_url text,
  cron_secret text,
  updated_at timestamptz not null default now()
);

revoke all on table private.app_settings from public, anon, authenticated;
grant select on table private.app_settings to service_role;

comment on table private.app_settings is
  'Deployment configuration for the notification cron job. Not reachable over HTTP: PostgREST does not serve the private schema.';

-- Reschedule the sender to read the table. Same guard as before — a project that has not been configured yet should
-- do nothing rather than post to "null/send-notifications" every minute.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('fastr-send-notifications')
     where exists (select 1 from cron.job where jobname = 'fastr-send-notifications');

    perform cron.schedule(
      'fastr-send-notifications',
      '* * * * *',
      $job$
      select net.http_post(
        url     := s.functions_url || '/send-notifications',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'x-fastr-cron-secret', s.cron_secret),
        timeout_milliseconds := 20000
      )
      from private.app_settings s
      where s.functions_url is not null
        and s.cron_secret is not null;
      $job$
    );
  end if;
exception
  when others then
    raise notice 'could not install the notification schedule: %', sqlerrm;
end;
$$;
