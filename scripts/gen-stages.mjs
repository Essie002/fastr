#!/usr/bin/env node
/**
 * Writes the fasting stage list from `packages/shared` into a migration. Requirement 6.6.
 *
 * The stage list is needed in two runtimes that cannot share an import: the web app reads it as
 * TypeScript, and the notification trigger reads it as rows in Postgres, because it has to work out
 * which stage notifications a fast should queue. Typing it out twice is exactly the drift this
 * requirement exists to prevent — a stage added in TypeScript and forgotten in SQL is a notification
 * that never fires, with nothing anywhere reporting an error.
 *
 * So TypeScript is the source of truth and this generates the SQL. CI runs the generator and fails if
 * the working tree changes, which turns forgetting into a red build rather than a silent gap.
 *
 * The output filename is fixed rather than timestamped, so regenerating rewrites the same migration
 * instead of stacking up a new one per edit. That is safe because the file is idempotent: it creates
 * the table if absent, then replaces its contents.
 *
 *   npm run gen:stages
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES } from '../packages/shared/src/stages.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'supabase', 'migrations', '20260930140000_fasting_stages.sql');

/** Postgres string literal. Doubling the quote is the only escape needed here. */
const sql = (value) => `'${String(value).replace(/'/g, "''")}'`;

const rows = STAGES.map(
  (stage) =>
    `  (${sql(stage.key)}, ${stage.atMinutes}, ${sql(stage.name)}, ${sql(stage.description)})`,
).join(',\n');

const contents = `-- GENERATED FILE — do not edit by hand.
--
-- Written by \`npm run gen:stages\` from packages/shared/src/stages.ts, which is the source of truth
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

-- Reference data, not user data, so this is the one table in \`public\` whose policy is not scoped to
-- \`auth.uid()\`. It holds nothing private: the same eight rows ship inside the web bundle. RLS is
-- still enabled, because \`scripts/check-rls.mjs\` requires it of every table and an exception carved
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
${rows};
`;

writeFileSync(target, contents);
console.log(
  `Wrote ${STAGES.length} stages to supabase/migrations/20260930140000_fasting_stages.sql`,
);
