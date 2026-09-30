#!/usr/bin/env node
/**
 * Fails if any table in the `public` schema has Row Level Security disabled. Requirement 18.3.
 *
 * A new table added without RLS is the single most likely way this app would leak one user's data to
 * another, and it is silent: every query keeps working, the tests keep passing, and the table is
 * simply readable by anyone with the anon key. That is a mistake to catch mechanically, not by
 * remembering, which is why this is a query against the catalog rather than a lint rule over SQL
 * text. A policy can be commented out, a `create table` can be written in a migration nobody
 * reviews closely, but `relrowsecurity` is the truth.
 *
 * Also checks that each table has at least one policy. RLS enabled with no policies denies
 * everything, which is safe but breaks the app in a way that looks like a bug rather than a
 * misconfiguration, so it is worth naming separately.
 *
 *   node scripts/check-rls.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };

const hostFile = join(root, '.docker-host');
if (!env.DOCKER_HOST && existsSync(hostFile)) {
  const match = readFileSync(hostFile, 'utf8').match(/^DOCKER_HOST=(.+)$/m);
  if (match) env.DOCKER_HOST = match[1].trim();
}

const runtime = env.DOCKER_HOST?.includes('podman') ? 'podman' : 'docker';

function query(sql) {
  try {
    return execFileSync(
      runtime,
      ['exec', 'supabase_db_fastr', 'psql', '-U', 'postgres', '-qAt', '-c', sql],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch (error) {
    console.error('Could not reach the local database. Is the stack running? `npm run setup`');
    console.error(String(error.stderr ?? error.message).trim());
    process.exit(1);
  }
}

// Views and the migration bookkeeping table are not user data and have no rows to protect.
const unprotected = query(`
  select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity
   order by 1;
`);

const policyless = query(`
  select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
   order by 1;
`);

/**
 * An `update` policy with `using` but no `with check` lets a user update their own row and reassign
 * its `user_id`, handing their data to somebody else. It is an odd-looking attack and a one-word
 * omission, so it is worth catching here as well as in the RLS test suite.
 */
const uncheckedUpdates = query(`
  select c.relname || '.' || p.polname
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and p.polcmd = 'w'
     and p.polwithcheck is null
   order by 1;
`);

const problems = [];

if (unprotected.length > 0) {
  problems.push(
    `Row Level Security is disabled on:\n  ${unprotected.join('\n  ')}\n` +
      '  Add `alter table public.<name> enable row level security;` and its policies.',
  );
}

if (policyless.length > 0) {
  problems.push(
    `RLS is on but no policy exists on:\n  ${policyless.join('\n  ')}\n` +
      '  This denies every query. Add policies, or the app will fail in a way that looks like a bug.',
  );
}

if (uncheckedUpdates.length > 0) {
  problems.push(
    `These update policies have \`using\` but no \`with check\`:\n  ${uncheckedUpdates.join('\n  ')}\n` +
      '  Without `with check`, a user can reassign their own row to another user.',
  );
}

const tableCount = query(`
  select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r';
`)[0];

if (problems.length > 0) {
  console.error(`\n${problems.join('\n\n')}\n`);
  process.exit(1);
}

console.log(`RLS check passed: ${tableCount} tables, all with RLS and at least one policy.`);
