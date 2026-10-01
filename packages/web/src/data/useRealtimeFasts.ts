import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabase } from './supabase.js';
import { activeFastQueryKey, fastHistoryQueryKey } from './fasts.js';

/**
 * Keeps this device in step with the others. Requirement 5.6.
 *
 * Two mechanisms, and the order they were built in matters.
 *
 * **A refetch when the app regains focus** is the primary one, and the only one that covers the case that
 * actually happens: a phone that has been in a pocket for six hours has no live socket, and the moment that
 * matters is when its owner opens the app. React Query does this through `refetchOnWindowFocus` and
 * `refetchOnReconnect`, which are set in `createQueryClient`.
 *
 * **Realtime** is the improvement on top, for when two devices are awake at once — ending a fast on a phone
 * while a laptop shows the timer. It is not relied upon, because a dropped socket is normal on mobile.
 *
 * The subscription invalidates rather than applying the payload. Trusting the payload means writing the
 * state-merging logic twice, once for fetches and once for events, and the two will disagree.
 */

export type RealtimeStatus = 'connecting' | 'live' | 'down';

export function useRealtimeFasts(userId: string | null): RealtimeStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  useEffect(() => {
    if (!userId) return;

    const supabase = getSupabase();

    // Named per user, so switching accounts on a shared laptop cannot leave the previous channel open.
    const channel = supabase
      .channel(`fasts:${userId}`)
      .on(
        'postgres_changes',
        // The filter is a convenience, not a security boundary: RLS already limits what this connection can
        // see. Without it the socket would carry every change in the table to every client.
        { event: '*', schema: 'public', table: 'fasts', filter: `user_id=eq.${userId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: activeFastQueryKey });
          void queryClient.invalidateQueries({ queryKey: fastHistoryQueryKey });
        },
      )
      .subscribe((state: string) => {
        if (state === 'SUBSCRIBED') setStatus('live');
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          setStatus('down');
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  return status;
}
