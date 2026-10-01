/**
 * The clock the timer counts from.
 *
 * A phone with a wrong clock shows a wrong elapsed time even when the stored start time is perfect, and
 * phones do drift — a minute or two is common, and a device whose time has been set by hand can be out by
 * far more. The fast's start is recorded by the server, so measuring against an uncorrected local clock
 * compares two different clocks.
 *
 * So the offset between them is measured once per session and applied everywhere elapsed time is computed.
 * The measurement is free: every HTTP response carries a `Date` header, so reading one already-needed
 * response gives the server's clock without an extra request.
 */

/** Below this, the difference is network jitter rather than a wrong clock, and correcting it adds noise. */
const MEANINGFUL_SKEW_MS = 30_000;

let offsetMs = 0;

/**
 * Records the server's clock from a response's `Date` header.
 *
 * Half the round trip is added back, because the header was written before the response travelled to us.
 * On a slow mobile connection that is worth a few hundred milliseconds, which matters only in that leaving
 * it out biases every measurement in the same direction.
 */
export function recordServerTime(serverDate: Date, roundTripMs = 0): void {
  const measured = serverDate.getTime() + roundTripMs / 2 - Date.now();
  offsetMs = Math.abs(measured) >= MEANINGFUL_SKEW_MS ? measured : 0;
}

/** Reads the `Date` header from a fetch Response, if it has a usable one. */
export function recordServerTimeFromResponse(response: Response, roundTripMs = 0): void {
  const header = response.headers.get('date');
  if (!header) return;
  const parsed = new Date(header);
  if (Number.isNaN(parsed.getTime())) return;
  recordServerTime(parsed, roundTripMs);
}

/** The current time, corrected towards the server's clock. */
export function now(): number {
  return Date.now() + offsetMs;
}

export function currentOffsetMs(): number {
  return offsetMs;
}

/** For tests, and for signing out: the next session measures its own offset. */
export function resetClockOffset(): void {
  offsetMs = 0;
}

/**
 * Wraps `fetch` so every Supabase response updates the offset.
 *
 * Handed to the Supabase client as its `fetch`, which means the measurement happens on requests the app was
 * making anyway, and keeps improving as the session goes on. A dedicated time endpoint would be one more
 * round trip for something already in every header.
 */
export function clockTrackingFetch(
  base: typeof fetch = fetch,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const started = Date.now();
    const response = await base(input, init);
    recordServerTimeFromResponse(response, Date.now() - started);
    return response;
  };
}
