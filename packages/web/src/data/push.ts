import { getSupabase } from './supabase.js';

/**
 * Push subscriptions. Requirement 7.
 *
 * A subscription identifies one browser on one device. A user with a phone and a laptop has two rows, and a goal
 * notification goes to both.
 */

export const pushQueryKey = ['push', 'subscriptions'] as const;

export interface StoredSubscription {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
  lastOkAt: string | null;
  failures: number;
}

/**
 * The VAPID public key, baked in at build time.
 *
 * Public by design: it is what a push service checks the message signature against. The private half lives only
 * as an Edge Function secret (Requirement 7.9).
 */
export function vapidPublicKey(): string | null {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  return key && key.trim() !== '' ? key.trim() : null;
}

/**
 * The key as `subscribe` wants it.
 *
 * `applicationServerKey` takes raw bytes, not the base64url string every other part of this system uses, so it
 * has to be decoded here. Passing the string through silently produces an `InvalidCharacterError` on some
 * browsers and a subscription that no server can sign for on others.
 */
export function decodeVapidKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Backed by an explicit ArrayBuffer, because `applicationServerKey` will not take a view over a
  // SharedArrayBuffer and the plain `new Uint8Array(length)` type allows one.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export async function fetchSubscriptions(): Promise<StoredSubscription[]> {
  const { data, error } = await getSupabase()
    .from('push_subscriptions')
    .select('id, endpoint, user_agent, created_at, last_ok_at, failures')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const typed = row as {
      id: string;
      endpoint: string;
      user_agent: string | null;
      created_at: string;
      last_ok_at: string | null;
      failures: number;
    };
    return {
      id: typed.id,
      endpoint: typed.endpoint,
      userAgent: typed.user_agent,
      createdAt: typed.created_at,
      lastOkAt: typed.last_ok_at,
      failures: typed.failures,
    };
  });
}

/**
 * Stores a browser's subscription.
 *
 * An upsert on the endpoint, because a browser that re-subscribes produces the same endpoint. Inserting would
 * either fail on the unique constraint or, without one, leave two rows and send every notification twice.
 */
export async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const { data: user } = await getSupabase().auth.getUser();
  if (!user.user) throw new Error('Not signed in.');

  const json = subscription.toJSON();
  const keys = json.keys ?? {};

  if (!keys.p256dh || !keys.auth) {
    // Without both, the payload cannot be encrypted and every send would fail with an opaque error.
    throw new Error('That subscription is missing its encryption keys.');
  }

  const { error } = await getSupabase()
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.user.id,
        endpoint: subscription.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        // Only to tell devices apart in the settings list. Trimmed, because the column is capped at 500 characters
        // and some user agents are longer than that.
        user_agent: navigator.userAgent.slice(0, 500),
        failures: 0,
      },
      { onConflict: 'endpoint' },
    );

  if (error) throw error;
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  const { error } = await getSupabase()
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint);
  if (error) throw error;
}

/** A short name for a stored subscription, for the settings list. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/Android/.test(userAgent)) return 'Android device';
  if (/Macintosh/.test(userAgent)) return 'Mac';
  if (/Windows/.test(userAgent)) return 'Windows PC';
  if (/Linux/.test(userAgent)) return 'Linux computer';
  return 'Unknown device';
}
