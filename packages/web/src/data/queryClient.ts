import { QueryClient } from '@tanstack/react-query';

/**
 * Query defaults, chosen for an app whose central number changes every second but whose *data*
 * changes a few times a day.
 *
 * The timer is not a query. It is computed from the fast's stored `start_at` on a local interval, so
 * none of this governs how smoothly it ticks. What these settings govern is how often the app asks the
 * server whether the fast itself changed, which is a different and much slower question.
 */

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Fasting data changes on user action, and those actions invalidate their own queries. A
        // minute is long enough to make navigating between screens instant and short enough that a
        // change made on another device cannot linger.
        staleTime: 60_000,
        gcTime: 15 * 60_000,

        // Requirement 5.6's primary mechanism. Realtime is the improvement on top; this is what
        // makes a phone correct when it is unlocked after four hours, which is the case that
        // actually matters.
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,

        // Two attempts, then show the error. A phone on a train will fail regardless, and retrying
        // five times only delays telling the user why the screen is empty.
        retry: 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),

        // Offline, the last successful result is what keeps the timer on screen (Requirement 15.4),
        // so queries must not be treated as failed simply because the network is gone.
        networkMode: 'offlineFirst',
      },
      mutations: {
        // A write must not be retried blindly: starting a fast twice trips the overlap constraint and
        // the second error is more confusing than the first failure.
        retry: 0,
        networkMode: 'online',
      },
    },
  });
}
