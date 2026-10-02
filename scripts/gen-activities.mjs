#!/usr/bin/env node
/**
 * Writes the activity type list from `packages/shared` into a migration and a Deno module.
 * Requirement 1.2.
 *
 * The same arrangement as `gen-stages.mjs`, for the same reason: one list is needed in three runtimes that
 * cannot share an import. The web app reads it as TypeScript. Postgres needs the rows so `activities.type_key`
 * can be a foreign key, which is what stops a typo producing an activity the notification composer has no copy
 * for. And the Edge Function needs the labels to compose "Time for a swim" without a database round trip per
 * notification — it cannot import from `packages/shared`, because `supabase functions deploy` bundles only the
 * function's own directory.
 *
 * Three copies of one fact is three places it can drift, and the drift is silent: an activity type added in
 * TypeScript and missing from SQL is a foreign key violation the moment a user picks it. So TypeScript is the
 * source of truth, this generates the rest, and CI regenerates and fails if the tree changed.
 *
 * The migration filename is fixed rather than timestamped, so regenerating rewrites one file instead of stacking
 * a new migration per edit. Safe because the file is idempotent: create if absent, then replace the contents.
 *
 *   npm run gen:activities
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVITY_TYPES } from '../packages/shared/src/activities.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'supabase', 'migrations', '20261003090000_activity_types.sql');
const denoDir = join(root, 'supabase', 'functions', '_shared');

/** Postgres string literal. Doubling the quote is the only escape needed here. */
const sql = (value) => `'${String(value).replace(/'/g, "''")}'`;

const rows = ACTIVITY_TYPES.map(
  (type) =>
    `  (${sql(type.key)}, ${sql(type.label)}, ${sql(type.icon)}, ${type.defaultMinutes}, ` +
    `${sql(type.unit)}, ${type.sortOrder})`,
).join(',\n');

const contents = `-- GENERATED FILE — do not edit by hand.
--
-- Written by \`npm run gen:activities\` from packages/shared/src/activities.ts, which is the source of
-- truth for the preset activity list (Requirement 1.2). Edit the TypeScript and re-run the generator;
-- CI fails if this file does not match.
--
-- Postgres needs its own copy so that \`activities.type_key\` can be a foreign key against it. Without
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

-- Reference data rather than user data, so this is the second table in \`public\` whose policy is not
-- scoped to \`auth.uid()\` — the first being fasting_stages, for the same reason. It holds nothing
-- private: the same rows ship inside the web bundle. RLS stays enabled because
-- \`scripts/check-rls.mjs\` requires it of every table, and an exception carved out for one table is
-- an exception somebody later widens.
alter table public.activity_types enable row level security;

drop policy if exists activity_types_select on public.activity_types;
create policy activity_types_select on public.activity_types
  for select using (true);

-- Replace rather than upsert, so a type removed from the TypeScript list disappears here too. An
-- upsert would leave it behind forever. Re-runnable, which is what lets this file keep a fixed name.
--
-- \`delete\` rather than \`truncate\`: activities.type_key references this table, and truncate on a
-- referenced table fails unless cascaded — and cascading would delete the user's activities. A
-- delete fails loudly against a type still in use instead, which is the correct outcome: removing a
-- type somebody is using is a data decision, not a code change.
delete from public.activity_types;

insert into public.activity_types (key, label, icon, default_minutes, unit, sort_order) values
${rows};
`;

writeFileSync(target, contents);

mkdirSync(denoDir, { recursive: true });

writeFileSync(
  join(denoDir, 'activityTypes.ts'),
  `// GENERATED FILE — do not edit by hand.
//
// Written by \`npm run gen:activities\` from packages/shared/src/activities.ts, which is the source of truth.
// Edge Functions cannot import from packages/shared, because \`functions deploy\` bundles only the function's
// own directory. CI regenerates this and fails if it differs.

export interface ActivityType {
  key: string;
  label: string;
  icon: string;
  defaultMinutes: number;
  unit: 'minutes' | 'ml';
  sortOrder: number;
}

export const ACTIVITY_TYPES: readonly ActivityType[] = ${JSON.stringify(ACTIVITY_TYPES, null, 2)};

/** Lookup by key. Undefined for a custom activity, which has no type. */
export function findActivityType(key: string | null | undefined): ActivityType | undefined {
  if (!key) return undefined;
  return ACTIVITY_TYPES.find((type) => type.key === key);
}
`,
);

console.log(
  `Wrote ${ACTIVITY_TYPES.length} activity types to supabase/migrations and supabase/functions/_shared/`,
);
