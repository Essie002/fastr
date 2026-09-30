/**
 * The generated `fasting_stages` table matches the shared list. Requirement 6.6.
 *
 * The web app reads the stage list from TypeScript and the notification trigger reads it from
 * Postgres. That is two copies of one fact, and the failure when they diverge is silent: a stage
 * added in TypeScript but not regenerated simply never queues a notification, with nothing anywhere
 * reporting a problem.
 *
 * Two things guard against it, and both are needed. CI runs `npm run gen:stages` and fails if the
 * working tree changes, which catches forgetting to regenerate. This suite compares the rows actually
 * in the database against the list actually in the bundle, which catches a migration that was
 * regenerated but never applied.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { STAGES } from '@fastr/shared';
import { hasStack, localStack, signedInClient, type LocalStack } from './helpers.js';

interface StageRow {
  key: string;
  at_minutes: number;
  name: string;
  description: string;
}

describe.skipIf(!hasStack())('fasting_stages', () => {
  let stack: LocalStack;
  let user: SupabaseClient;
  let rows: StageRow[];

  beforeAll(async () => {
    stack = localStack()!;
    user = await signedInClient(stack, 'a');
    const { data, error } = await user
      .from('fasting_stages')
      .select('key, at_minutes, name, description')
      .order('at_minutes');
    expect(error).toBeNull();
    rows = (data ?? []) as StageRow[];
  });

  it('holds exactly the stages the shared list holds, with the same values', async () => {
    expect(rows).toEqual(
      STAGES.map((stage) => ({
        key: stage.key,
        at_minutes: stage.atMinutes,
        name: stage.name,
        description: stage.description,
      })),
    );
  });

  it('is readable by any signed-in user', async () => {
    // Reference data, not user data: this is the one table whose policy is not scoped to auth.uid().
    // The same rows ship inside the web bundle, so there is nothing here to protect.
    const other = await signedInClient(stack, 'b');
    const { data } = await other.from('fasting_stages').select('key');
    expect((data ?? []).length).toBe(STAGES.length);
  });

  it('is not writable by a signed-in user', async () => {
    const { error } = await user
      .from('fasting_stages')
      .insert({ key: 'invented', at_minutes: 999, name: 'Invented', description: 'No.' });
    expect(error).not.toBeNull();
  });
});
