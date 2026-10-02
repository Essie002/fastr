/**
 * Test harness for the database suites.
 *
 * These tests talk to a real local Supabase rather than a mock, for the same reason Rally runs a real
 * Redis: a mocked exclusion constraint always passes, and two of this project's requirements live
 * inside one. A mocked RLS policy is worse still, since it would assert the thing it is pretending
 * to be.
 *
 * ## Skipping locally, failing in CI
 *
 * With no stack running these suites skip with a warning, so a contributor can run `npm test` on a
 * machine with no container runtime and get the unit tests. In CI that would be dangerous: a green
 * run that silently skipped every isolation test is worse than no run at all. So CI sets
 * `FASTR_REQUIRE_DB=1` and a missing stack becomes a failure.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

export interface LocalStack {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export const SEED_USERS = {
  a: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'a@fastr.test',
    timeZone: 'Africa/Nairobi',
  },
  b: {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'b@fastr.test',
    timeZone: 'Europe/London',
  },
} as const;

export const SEED_PASSWORD = 'fastr-local-dev';

function dockerHost(): string | undefined {
  if (process.env.DOCKER_HOST) return process.env.DOCKER_HOST;
  const file = join(root, '.docker-host');
  if (!existsSync(file)) return undefined;
  return readFileSync(file, 'utf8')
    .match(/^DOCKER_HOST=(.+)$/m)?.[1]
    ?.trim();
}

/**
 * Reads the local stack's URL and keys from the CLI.
 *
 * `supabase status` is slow enough to matter, so the result is cached for the process. Reading
 * `packages/web/.env.local` instead would be faster and wrong: it holds only the anon key, and these
 * suites need the service role key to set up fixtures that RLS is supposed to block.
 */
let cached: LocalStack | null | undefined;

export function localStack(): LocalStack | null {
  if (cached !== undefined) return cached;

  const env = { ...process.env };
  const host = dockerHost();
  if (host) env.DOCKER_HOST = host;

  try {
    const output = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });

    const values = new Map(
      output
        .split('\n')
        .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
        .filter((match): match is RegExpMatchArray => match !== null)
        .map((match) => [match[1] as string, match[2] as string]),
    );

    const url = values.get('API_URL');
    const anonKey = values.get('ANON_KEY');
    const serviceRoleKey = values.get('SERVICE_ROLE_KEY');

    cached = url && anonKey && serviceRoleKey ? { url, anonKey, serviceRoleKey } : null;
  } catch {
    cached = null;
  }

  if (cached === null && process.env.FASTR_REQUIRE_DB === '1') {
    throw new Error(
      'FASTR_REQUIRE_DB=1 but no local Supabase is reachable. In CI this is a failure, not a skip.',
    );
  }

  return cached;
}

/** True when the database suites should run. Used as `describe.skipIf(!hasStack())`. */
export function hasStack(): boolean {
  const stack = localStack();
  if (stack === null) {
    console.warn(
      '\n  Skipping the database suites: no local Supabase.\n  Start it with `npm run setup`.\n',
    );
    return false;
  }
  return true;
}

/** A client with no session. What an unauthenticated visitor holds. */
export function anonClient(stack: LocalStack): SupabaseClient {
  return createClient(stack.url, stack.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A client signed in as one of the seed users, holding a real JWT, so `auth.uid()` inside a policy
 * returns that user. This is the only way to test RLS honestly: the service role bypasses it
 * entirely, so a suite written with the service role would prove nothing.
 */
export async function signedInClient(
  stack: LocalStack,
  which: keyof typeof SEED_USERS,
): Promise<SupabaseClient> {
  const client = createClient(stack.url, stack.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.auth.signInWithPassword({
    email: SEED_USERS[which].email,
    password: SEED_PASSWORD,
  });

  if (error) {
    throw new Error(
      `Could not sign in as ${SEED_USERS[which].email}: ${error.message}. ` +
        'Has the seed run? Try `npm run db:reset`.',
    );
  }

  return client;
}

/**
 * A client that bypasses RLS. Used only to plant a fixture belonging to one user so another user can
 * be shown failing to reach it, and to clean up afterwards. Never used to assert anything.
 */
export function serviceClient(stack: LocalStack): SupabaseClient {
  return createClient(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Every table holding user data, with the column naming its owner. Drives the RLS suite. */
export const USER_TABLES = [
  'fasts',
  'weight_entries',
  'water_entries',
  'day_notes',
  'push_subscriptions',
  'reminders',
  'notifications',
] as const;

export type UserTable = (typeof USER_TABLES)[number];

/**
 * A minimal valid row for each table, owned by the given user.
 *
 * `seed` shifts every time value, so rows planted for different tests cannot collide with the
 * overlap constraint on fasts. Getting that wrong produces a failure that looks like an RLS problem
 * and is not, which is the most confusing possible outcome for this suite.
 */
export function sampleRow(table: UserTable, userId: string, seed: number): Record<string, unknown> {
  const base = Date.UTC(2020, 0, 1) + seed * 7 * 86_400_000;
  const iso = (offsetMs: number) => new Date(base + offsetMs).toISOString();
  const day = new Date(base).toISOString().slice(0, 10);

  switch (table) {
    case 'fasts':
      return {
        user_id: userId,
        plan_id: '16:8',
        goal_minutes: 960,
        start_at: iso(0),
        ended_at: iso(16 * 3_600_000),
        status: 'completed',
      };
    case 'weight_entries':
      return { user_id: userId, measured_on: day, grams: 72_000 };
    case 'water_entries':
      return { user_id: userId, logged_at: iso(0), ml: 250 };
    case 'day_notes':
      return { user_id: userId, day, mood: 4, energy: 4, note: 'fine' };
    case 'push_subscriptions':
      return {
        user_id: userId,
        endpoint: `https://push.example.test/${userId}/${seed}`,
        p256dh: 'test-p256dh',
        auth: 'test-auth',
      };
    case 'reminders':
      return { user_id: userId, local_time: '20:00', weekdays: [1, 2, 3], enabled: true };
    case 'notifications':
      // No fast_id: the reminder kind is the one shape that needs no parent row, which keeps this
      // fixture independent of the overlap constraint.
      return { user_id: userId, kind: 'reminder', due_at: iso(0), status: 'pending' };
  }
}

/**
 * Removes every row belonging to the seed users. Run between suites with the service role.
 *
 * Note that this is the same database the dev server talks to, so running the suite leaves the app empty — no
 * history, no streaks, no weight for `a@fastr.test`. That is the price of test isolation against a real Postgres
 * rather than a fake, and it is deliberate: `npm run db:reset` puts the demo data back. The README says so too,
 * because the symptom looks exactly like a broken query.
 */
export async function resetUserData(stack: LocalStack): Promise<void> {
  const service = serviceClient(stack);
  const ids = [SEED_USERS.a.id, SEED_USERS.b.id];
  // notifications before fasts: the cascade would handle it, but being explicit keeps the order
  // obvious if a table is added later.
  for (const table of ['notifications', ...USER_TABLES.filter((t) => t !== 'notifications')]) {
    await service.from(table).delete().in('user_id', ids);
  }
}
