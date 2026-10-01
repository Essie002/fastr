import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clockTrackingFetch,
  currentOffsetMs,
  now,
  recordServerTime,
  recordServerTimeFromResponse,
  resetClockOffset,
} from './clock.js';

afterEach(() => {
  resetClockOffset();
  vi.useRealTimers();
});

describe('clock offset', () => {
  it('starts at zero, trusting the device until told otherwise', () => {
    expect(currentOffsetMs()).toBe(0);
  });

  it('ignores a difference small enough to be network jitter', () => {
    // Correcting a few seconds would add noise without changing anything a user can see.
    recordServerTime(new Date(Date.now() + 5_000));
    expect(currentOffsetMs()).toBe(0);
  });

  it('corrects a clock that is meaningfully behind', () => {
    // A phone five minutes slow would otherwise under-report every fast by five minutes.
    recordServerTime(new Date(Date.now() + 5 * 60_000));
    expect(currentOffsetMs()).toBeGreaterThan(4 * 60_000);
    expect(now()).toBeGreaterThan(Date.now() + 4 * 60_000);
  });

  it('corrects a clock that is meaningfully ahead', () => {
    recordServerTime(new Date(Date.now() - 10 * 60_000));
    expect(currentOffsetMs()).toBeLessThan(-9 * 60_000);
  });

  it('adds back half the round trip', () => {
    // The header was written before the response travelled to us. Ignoring that biases every measurement
    // in the same direction, which matters on a slow mobile connection.
    const serverTime = new Date(Date.now() + 10 * 60_000);
    recordServerTime(serverTime, 2_000);
    expect(currentOffsetMs()).toBeCloseTo(10 * 60_000 + 1_000, -2);
  });
});

describe('recordServerTimeFromResponse', () => {
  const withDate = (value: string | null) =>
    ({ headers: { get: () => value } }) as unknown as Response;

  it('reads a Date header', () => {
    recordServerTimeFromResponse(withDate(new Date(Date.now() + 6 * 60_000).toUTCString()));
    expect(currentOffsetMs()).not.toBe(0);
  });

  it('does nothing when the header is missing', () => {
    recordServerTimeFromResponse(withDate(null));
    expect(currentOffsetMs()).toBe(0);
  });

  it('does nothing when the header is unparseable', () => {
    // A proxy can rewrite headers. A NaN offset would make every duration NaN, which is worse than
    // trusting the device.
    recordServerTimeFromResponse(withDate('not a date'));
    expect(currentOffsetMs()).toBe(0);
  });
});

describe('clockTrackingFetch', () => {
  it('measures from a real response and passes it through unchanged', async () => {
    const response = {
      headers: { get: () => new Date(Date.now() + 7 * 60_000).toUTCString() },
    } as unknown as Response;

    const tracked = clockTrackingFetch(async () => response);
    const returned = await tracked('https://example.test');

    expect(returned).toBe(response);
    expect(currentOffsetMs()).not.toBe(0);
  });

  it('does not swallow a failed request', async () => {
    const tracked = clockTrackingFetch(async () => {
      throw new Error('network down');
    });
    await expect(tracked('https://example.test')).rejects.toThrow('network down');
  });
});
