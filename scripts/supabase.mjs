#!/usr/bin/env node
/**
 * The Supabase CLI, with `DOCKER_HOST` already set.
 *
 * `npm run setup` works out which container runtime this machine has and writes the socket to
 * `.docker-host`. Every later CLI call needs the same value, and the failure when it is missing is a
 * Go dial error that says nothing about Podman, so rather than asking people to export a variable in
 * every shell, the db:* scripts go through here.
 *
 * Usage mirrors the CLI exactly: `node scripts/supabase.mjs db reset`.
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

try {
  execFileSync('npx', ['supabase', ...process.argv.slice(2)], {
    cwd: root,
    env,
    // stdin ignored rather than inherited: a CLI prompt with no visible output looks like a hang.
    stdio: ['ignore', 'inherit', 'inherit'],
  });
} catch (error) {
  process.exit(typeof error.status === 'number' ? error.status : 1);
}
