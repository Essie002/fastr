/**
 * Checks a pair of `datetime-local` values before they are sent.
 *
 * Module scope rather than inside a component, for two reasons. It reads the clock, and a function defined in
 * a component body that calls `Date.now()` is flagged as impure even when it only ever runs from an event
 * handler. And both the edit form and the add form need exactly these three rules, so having them in one
 * place is what stops the two drifting into disagreeing about what a valid fast is.
 *
 * Every rule here is also enforced by Postgres. These exist for the message, not for the guarantee.
 */
export interface FastTimes {
  startMs: number;
  endMs: number;
}

export type FastTimesResult = { ok: true; times: FastTimes } | { ok: false; problem: string };

export function validateFastTimes(startAt: string, endedAt: string): FastTimesResult {
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endedAt);

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return { ok: false, problem: 'Both times are needed.' };
  }
  if (endMs <= startMs) {
    return { ok: false, problem: 'A fast cannot end before it started.' };
  }
  // A minute of slack, because a device clock slightly ahead of the server's is normal and refusing a fast
  // the user just ended would be wrong.
  if (endMs > Date.now() + 60_000) {
    return { ok: false, problem: 'A fast cannot end in the future.' };
  }

  return { ok: true, times: { startMs, endMs } };
}
