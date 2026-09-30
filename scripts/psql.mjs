#!/usr/bin/env node
/**
 * `psql` against the local database, without needing psql installed on the host.
 *
 *   npm run db:psql -- -c "select count(*) from public.fasts"
 *   npm run db:psql -- -f supabase/tests/manual/constraint-probe.sql
 *
 * The local stack already contains a Postgres image with the client in it, so this runs psql inside
 * that container rather than asking every contributor to install Postgres locally as well. A file
 * passed with `-f` is copied in first, since the container cannot see the host's filesystem.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };

const hostFile = join(root, '.docker-host');
if (!env.DOCKER_HOST && existsSync(hostFile)) {
  const match = readFileSync(hostFile, 'utf8').match(/^DOCKER_HOST=(.+)$/m);
  if (match) env.DOCKER_HOST = match[1].trim();
}

// Whichever runtime is present. The container name is the same either way.
const runtime = env.DOCKER_HOST?.includes('podman') ? 'podman' : 'docker';
const container = 'supabase_db_fastr';

const args = [...process.argv.slice(2)];

// Copy any -f target into the container and rewrite the path to point at the copy.
for (let i = 0; i < args.length; i += 1) {
  if ((args[i] === '-f' || args[i] === '--file') && args[i + 1]) {
    const hostPath = join(root, args[i + 1]);
    if (!existsSync(hostPath)) {
      console.error(`No such file: ${args[i + 1]}`);
      process.exit(1);
    }
    const staged = join(mkdtempSync(join(tmpdir(), 'fastr-psql-')), basename(hostPath));
    copyFileSync(hostPath, staged);
    const inside = `/tmp/${basename(hostPath)}`;
    execFileSync(runtime, ['cp', staged, `${container}:${inside}`], { env, stdio: 'inherit' });
    args[i + 1] = inside;
  }
}

try {
  execFileSync(runtime, ['exec', container, 'psql', '-U', 'postgres', ...args], {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
} catch (error) {
  process.exit(typeof error.status === 'number' ? error.status : 1);
}
