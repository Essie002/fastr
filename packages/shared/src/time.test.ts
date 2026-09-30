import { describe, expect, it } from 'vitest';
import { addDays, formatDuration, formatLocalTime, localDayOf, minutesBetween } from './time.js';

describe('localDayOf', () => {
  it('uses the given zone, not the runtime zone', () => {
    // The bug this function exists to prevent: 22:30 UTC is already tomorrow in Nairobi and still
    // today in London.
    const instant = '2026-09-29T22:30:00Z';
    expect(localDayOf(instant, 'Africa/Nairobi')).toBe('2026-09-30');
    expect(localDayOf(instant, 'Europe/London')).toBe('2026-09-29');
    expect(localDayOf(instant, 'America/Los_Angeles')).toBe('2026-09-29');
  });

  it('accepts a Date as well as a string', () => {
    expect(localDayOf(new Date('2026-01-15T00:00:00Z'), 'UTC')).toBe('2026-01-15');
  });

  it('returns a zero-padded ISO date', () => {
    expect(localDayOf('2026-01-05T12:00:00Z', 'UTC')).toBe('2026-01-05');
  });
});

describe('addDays', () => {
  it('moves forward and backward', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('advances exactly one calendar day across daylight saving transitions', () => {
    // Done with milliseconds instead of calendar parts, a 23-hour day lands on the same date twice
    // and a streak walk never terminates correctly.
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // spring forward in Europe
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26'); // fall back in Europe
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // spring forward in the US
  });

  it('round-trips', () => {
    expect(addDays(addDays('2026-06-15', 40), -40)).toBe('2026-06-15');
  });
});

describe('minutesBetween', () => {
  it('measures whole minutes and floors a partial one', () => {
    expect(minutesBetween('2026-09-30T10:00:00Z', '2026-09-30T12:30:00Z')).toBe(150);
    expect(minutesBetween('2026-09-30T10:00:00Z', '2026-09-30T10:00:59Z')).toBe(0);
  });

  it('is negative when the arguments are the wrong way round', () => {
    expect(minutesBetween('2026-09-30T12:00:00Z', '2026-09-30T10:00:00Z')).toBe(-120);
  });
});

describe('formatDuration', () => {
  it('pads the minutes so the timer does not jump width', () => {
    expect(formatDuration(962)).toBe('16h 02m');
    expect(formatDuration(960)).toBe('16h 00m');
  });

  it('drops the hours under an hour', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(0)).toBe('0m');
  });

  it('clamps a negative to zero rather than printing a minus sign', () => {
    expect(formatDuration(-5)).toBe('0m');
  });
});

describe('formatLocalTime', () => {
  it('renders a 24-hour time in the given zone', () => {
    expect(formatLocalTime('2026-09-30T10:00:00Z', 'Africa/Nairobi')).toBe('13:00');
    expect(formatLocalTime('2026-09-30T10:00:00Z', 'UTC')).toBe('10:00');
  });
});
