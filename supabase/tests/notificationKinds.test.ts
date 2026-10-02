import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NotificationKind } from '../../packages/shared/src/types.js';

/**
 * The set of notification kinds, asserted identical in all three places it is written. Requirement 12.2.
 *
 * It is written three times because it has to be. Postgres needs it as a CHECK constraint, since the queue is
 * a table and the constraint is what stops a typo becoming a row nothing can render. The web app needs it as a
 * TypeScript union. And the Edge Function needs its own copy, because `supabase functions deploy` bundles only
 * the function's own directory, so it cannot import from `packages/shared`.
 *
 * Nothing in any type system connects those three, and both ways they drift fail quietly:
 *
 *   - A kind in TypeScript but missing from the CHECK constraint is an insert that fails at queue time,
 *     inside a `security definer` SQL function, where the error goes to the Postgres log and nowhere a user
 *     or a developer is looking.
 *   - A kind in the constraint but missing from the Edge Function falls off the end of `compose`, which had
 *     no `default` case, and the user receives a push notification with no title and no body.
 *
 * So this test parses all three and compares them as sets. It is crude — it reads source files as text — and
 * it is the only thing standing between a future kind and one of those two outcomes.
 */

const repoRoot = join(import.meta.dirname, '..', '..');

/** Every `kind in (...)` list from the migrations, latest definition winning. */
function kindsFromMigrations(): Set<string> {
  const dir = join(repoRoot, 'supabase', 'migrations');
  // Sorted, because the constraint is dropped and recreated by a later migration and the last one is the
  // one that is actually in force.
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  let latest: Set<string> | null = null;

  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    // `kind in ('goal', 'stage', ...)` as written in the notifications_kind_check constraint.
    for (const match of sql.matchAll(/notifications_kind_check check \(\s*kind in \(([^)]*)\)/g)) {
      const list = match[1]!;
      latest = new Set([...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!));
    }
    // The original definition, written inline in the create table rather than as a named constraint.
    for (const match of sql.matchAll(/kind\s+text\s+not null check \(kind in \(([^)]*)\)\)/g)) {
      const list = match[1]!;
      latest = new Set([...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!));
    }
  }

  if (latest === null) throw new Error('No notifications kind constraint found in the migrations');
  return latest;
}

/** The union in `packages/shared/src/types.ts`, read as text rather than as a type. */
function kindsFromShared(): Set<string> {
  const source = readFileSync(join(repoRoot, 'packages', 'shared', 'src', 'types.ts'), 'utf8');
  const match = /export type NotificationKind =([\s\S]*?);/.exec(source);
  if (!match) throw new Error('NotificationKind not found in packages/shared');
  return new Set([...match[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!));
}

/** The inline union on the Edge Function's own row interface. */
function kindsFromEdgeFunction(): Set<string> {
  const source = readFileSync(
    join(repoRoot, 'supabase', 'functions', 'send-notifications', 'index.ts'),
    'utf8',
  );
  const match = /kind:\s*([^;]+);/.exec(source);
  if (!match) throw new Error('kind union not found in send-notifications');
  return new Set([...match[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!));
}

const sorted = (set: Set<string>) => [...set].sort();

describe('notification kinds agree across all three runtimes (Req 12.2)', () => {
  const migrations = kindsFromMigrations();
  const shared = kindsFromShared();
  const edge = kindsFromEdgeFunction();

  it('finds a non-trivial set in each place', () => {
    // Guards against a regex quietly matching nothing, which would make every assertion below pass
    // vacuously — the exact failure this suite is supposed to prevent.
    expect(migrations.size).toBeGreaterThan(3);
    expect(shared.size).toBeGreaterThan(3);
    expect(edge.size).toBeGreaterThan(3);
  });

  it('matches between the SQL constraint and the shared TypeScript union', () => {
    expect(sorted(shared)).toEqual(sorted(migrations));
  });

  it('matches between the SQL constraint and the Edge Function union', () => {
    expect(sorted(edge)).toEqual(sorted(migrations));
  });

  it('includes the activity kinds', () => {
    for (const set of [migrations, shared, edge]) {
      expect(sorted(set)).toContain('activity_start');
      expect(sorted(set)).toContain('activity_end');
    }
  });

  it('keeps the TypeScript union assignable from every value the database allows', () => {
    // A compile-time check that the runtime sets above cannot make: if a kind is added to the SQL and to
    // this list but not to the union, this stops building.
    const everyKind: NotificationKind[] = [
      'goal',
      'stage',
      'hour_before',
      'reminder',
      'activity_start',
      'activity_end',
    ];
    expect(sorted(new Set(everyKind))).toEqual(sorted(migrations));
  });
});
