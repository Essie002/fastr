import { useEffect, useState } from 'react';
import { now } from '../time/clock.js';

/**
 * Re-renders roughly once a second and returns the corrected current time.
 *
 * The interval is for *painting*, not for counting. Elapsed time is always recomputed from the fast's stored
 * start, never accumulated here, because an accumulated counter drifts, stops when a phone sleeps, and is
 * throttled to once a minute in a background tab. Requirement 5.5.
 *
 * It also recomputes immediately when the tab becomes visible again, so a phone unlocked after four hours is
 * correct on the first frame rather than after the next tick.
 */
export function useTick(active: boolean): number {
  const [time, setTime] = useState(() => now());

  useEffect(() => {
    if (!active) return;

    const update = () => setTime(now());
    update();

    const interval = window.setInterval(update, 1000);

    // Without this, returning to the app shows a stale number for up to a second — and in a throttled
    // background tab, for far longer.
    const onVisible = () => {
      if (document.visibilityState === 'visible') update();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);

  return time;
}
