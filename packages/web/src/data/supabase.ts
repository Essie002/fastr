import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readConfig } from '../config.js';
import { clockTrackingFetch } from '../time/clock.js';

/**
 * The Supabase client. One per document.
 *
 * Created once and reused, because each client opens its own auth listener and its own realtime
 * socket. Two clients means two sessions racing to refresh the same token, which shows up as a user
 * being signed out at random.
 *
 * Created lazily rather than at module load so that a missing configuration surfaces as a rendered
 * error screen rather than a blank page: an exception thrown while modules are still evaluating
 * happens before React can mount anything to show it in.
 */

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const config = readConfig(import.meta.env as unknown as Record<string, string | undefined>);

  client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      // The session lives in localStorage and is refreshed in the background, so opening the app
      // after a week does not mean signing in again. Requirement 2.4.
      persistSession: true,
      autoRefreshToken: true,
      // Fastr has no OAuth providers, so there is never a token in the URL to detect, and leaving
      // this on makes the client inspect every navigation for one.
      detectSessionInUrl: false,
      storageKey: 'fastr.auth',
    },
    realtime: {
      // A handful of row changes for one user. The default of 10 per second is for a chat app.
      params: { eventsPerSecond: 2 },
    },
    global: {
      headers: { 'x-fastr-client': 'web' },
      // Every response carries a `Date` header, so the timer learns the server's clock from requests the
      // app was making anyway. Requirement 5.5: a phone whose own clock is wrong still shows the right
      // elapsed time.
      fetch: clockTrackingFetch(),
    },
  });

  return client;
}

/** Test seam. Lets a suite install a stub without every module reaching for a singleton. */
export function setSupabase(replacement: SupabaseClient | null): void {
  client = replacement;
}
