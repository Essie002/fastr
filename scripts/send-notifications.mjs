#!/usr/bin/env node
/**
 * Invokes the sender once, locally.
 *
 * Needed because `pg_cron` does not reliably fire in the local stack — it is installed, and the job is scheduled,
 * but the background worker does not run dependably in the CLI's container. So the schedule is verified against
 * the hosted project and the function is driven by hand during development.
 *
 * Stated here and in the README rather than left to be discovered as a bug, because "my notification never
 * arrived locally" otherwise looks like a problem with the sender.
 *
 *   npm run send:notifications
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

function status() {
  const output = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Map(
    output
      .split('\n')
      .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]]),
  );
}

const values = status();
const functionsUrl = values.get('FUNCTIONS_URL') ?? 'http://127.0.0.1:54321/functions/v1';

// Matches the value the local stack serves functions with. In the hosted project this is a real secret; locally
// it only has to agree with whatever `supabase functions serve` was given.
const secret = env.CRON_SECRET ?? 'local-cron-secret';

const response = await fetch(`${functionsUrl}/send-notifications`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-fastr-cron-secret': secret },
});

const body = await response.text();
console.log(`${response.status} ${body}`);

if (response.status === 403) {
  console.error(
    '\nRejected. The function expects CRON_SECRET to match what it was started with:\n' +
      '  CRON_SECRET=local-cron-secret npx supabase functions serve send-notifications\n',
  );
}

process.exit(response.ok ? 0 : 1);
