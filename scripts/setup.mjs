#!/usr/bin/env node
/**
 * One command from a fresh clone to a running local stack. Requirement 20.3.
 *
 * Starts local Supabase, applies every migration from scratch, runs the seed, and writes the local
 * URL and anon key into `packages/web/.env.local`.
 *
 * That last step is the point of the script. Those values are printed by `supabase status` and are
 * fixed for the local stack, but copying them by hand is the step that goes wrong in a way that
 * looks like a broken app rather than a missing variable.
 *
 * ## Why this script knows about Podman
 *
 * The Supabase CLI speaks the Docker API and has no Podman support of its own. It finds the daemon
 * through `DOCKER_HOST`, which is all Podman needs to stand in: `podman machine start` runs a Linux
 * VM under Apple's own hypervisor and exposes a Docker-compatible socket. No Docker Desktop, and
 * nothing to install beyond `brew install podman`.
 *
 * This matters more than a convenience: on a machine where Docker Desktop is blocked by policy,
 * Podman is the difference between a working local stack and none at all. So rather than telling the
 * contributor to export a socket path they have to look up, this script finds it and sets it.
 */

import { execFileSync } from 'node:child_process';
import { createECDH } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The environment every CLI call inherits, including a `DOCKER_HOST` if we had to find one. */
const env = { ...process.env };

function run(command, args, { capture = false } = {}) {
  return execFileSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    // Inherited stdin would let the CLI block on a prompt with no visible reason.
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : ['ignore', 'inherit', 'inherit'],
  });
}

function quiet(command, args) {
  try {
    return execFileSync(command, args, {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** Is something answering the Docker API on the current `DOCKER_HOST`, or the default socket? */
function daemonReachable() {
  return quiet('docker', ['info']) !== null || quiet('podman', ['info']) !== null;
}

/**
 * Point `DOCKER_HOST` at the Podman machine's socket, starting the machine if it is not up.
 * Returns true when the socket is usable.
 */
function usePodman() {
  if (quiet('podman', ['--version']) === null) return false;

  const socketPath = () =>
    quiet('podman', [
      'machine',
      'inspect',
      '--format',
      '{{.ConnectionInfo.PodmanSocket.Path}}',
    ])?.trim();

  let socket = socketPath();
  if (!socket) {
    console.log('No Podman machine yet. Creating one (this downloads a small Linux VM image).');
    // The Supabase stack is a dozen containers; the 2 GB default is not enough for Postgres,
    // Auth, Realtime, Storage and Studio at once.
    run('podman', ['machine', 'init', '--memory', '6144', '--cpus', '4', '--disk-size', '60']);
    socket = socketPath();
  }

  const running = quiet('podman', ['machine', 'inspect', '--format', '{{.State}}'])?.trim();
  if (running !== 'running') {
    console.log('Starting the Podman machine.');
    run('podman', ['machine', 'start']);
    socket = socketPath();
  }

  if (!socket) return false;
  env.DOCKER_HOST = `unix://${socket}`;
  return quiet('podman', ['info']) !== null;
}

// Checked before anything else, because every failure past this point is a symptom of it, and the
// CLI's own message is a Go dial error that never mentions a container runtime.
if (!daemonReachable() && !usePodman()) {
  fail(
    [
      'No container runtime is reachable, and the Supabase CLI needs one.',
      '',
      'Either:',
      '  brew install podman        then re-run `npm run setup` (it handles the rest)',
      '  open -a Docker             if Docker Desktop is installed and permitted',
      '',
      'If both are blocked on this machine, see "Working without a container runtime"',
      'in the README: a hosted Supabase dev project needs no runtime at all.',
    ].join('\n'),
  );
}

if (env.DOCKER_HOST) {
  console.log(`Using the Podman socket at ${env.DOCKER_HOST}`);
}

/*
 * Local Edge Function secrets, before the stack starts so the runtime picks them up.
 *
 * Written rather than committed, and written rather than left to the contributor: without a CRON_SECRET the
 * sender can only ever answer 403 locally, which looks exactly like a bug in the function.
 *
 * The VAPID pair is generated fresh per machine. It is never used to reach a real push service from here, so it
 * only has to be well-formed.
 */
const functionsEnv = join(root, 'supabase', 'functions', '.env');
if (!existsSync(functionsEnv)) {
  const curve = createECDH('prime256v1');
  curve.generateKeys();

  writeFileSync(
    functionsEnv,
    [
      '# Written by `npm run setup`. Local development only, not committed.',
      'CRON_SECRET=local-cron-secret',
      `VAPID_PUBLIC_KEY=${curve.getPublicKey().toString('base64url')}`,
      `VAPID_PRIVATE_KEY=${curve.getPrivateKey('buffer').subarray(-32).toString('base64url')}`,
      'VAPID_SUBJECT=mailto:local@fastr.test',
      '',
    ].join('\n'),
  );
  console.log('Wrote supabase/functions/.env with local-only secrets.');
}

console.log('\nStarting local Supabase. The first run pulls a dozen images, so give it a while.');
run('npx', ['supabase', 'start']);

// `db reset` rather than `migration up`: it rebuilds from nothing and runs the seed, which is
// exactly what CI does, so a local database and a CI database are the same database.
console.log('\nApplying migrations and the seed.');
run('npx', ['supabase', 'db', 'reset']);

console.log('\nReading the local credentials.');
const status = run('npx', ['supabase', 'status', '-o', 'env'], { capture: true });

const values = new Map(
  status
    .split('\n')
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter((match) => match !== null)
    .map((match) => [match[1], match[2]]),
);

const apiUrl = values.get('API_URL');
const anonKey = values.get('ANON_KEY');

if (!apiUrl || !anonKey) {
  fail('Could not read API_URL and ANON_KEY from `supabase status -o env`.');
}

const webDir = join(root, 'packages', 'web');
if (!existsSync(webDir)) {
  // Expected until task 9 creates the package.
  mkdirSync(webDir, { recursive: true });
}

writeFileSync(
  join(webDir, '.env.local'),
  [
    '# Written by `npm run setup`. Not committed, and safe to delete: re-run setup to recreate it.',
    "# These are the local stack's fixed development values, not secrets.",
    `VITE_SUPABASE_URL=${apiUrl}`,
    `VITE_SUPABASE_ANON_KEY=${anonKey}`,
    '',
  ].join('\n'),
);

// Written so the test suite and any other tooling find the same runtime without repeating the
// discovery above. Sourced by `npm run db:*`.
if (env.DOCKER_HOST) {
  writeFileSync(
    join(root, '.docker-host'),
    `# Written by \`npm run setup\`. The container socket the Supabase CLI should use.\nDOCKER_HOST=${env.DOCKER_HOST}\n`,
  );
}

console.log(
  [
    '',
    'Ready.',
    '',
    `  API      ${apiUrl}`,
    `  Studio   ${values.get('STUDIO_URL') ?? 'http://127.0.0.1:54323'}`,
    `  Mail     ${values.get('MAILPIT_URL') ?? 'http://127.0.0.1:54324'}  (invite and reset emails)`,
    '',
    '  Sign in locally as a@fastr.test or b@fastr.test, password fastr-local-dev',
    '',
    '  npm test       everything, including the database and RLS suites',
    '  npm run dev    the web app (from task 9)',
    '',
  ].join('\n'),
);
