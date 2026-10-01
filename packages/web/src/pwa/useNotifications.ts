import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  decodeVapidKey,
  deleteSubscription,
  pushQueryKey,
  saveSubscription,
  vapidPublicKey,
} from '../data/push.js';
import { detectPlatform } from './platform.js';

/**
 * Turning notifications on for this device. Requirement 7.
 *
 * Permission is requested only from an explicit tap (Requirement 7.2), never on load. A prompt that appears
 * unbidden is the thing that teaches people to press Block, and a blocked permission cannot be asked for again
 * from the page — it has to be undone in browser settings. One careless prompt costs the feature permanently.
 */

export type NotificationState =
  'unsupported' | 'needs-install' | 'not-configured' | 'default' | 'granted' | 'denied' | 'working';

export interface NotificationsApi {
  state: NotificationState;
  /** Set when enabling failed for a reason the user can act on. */
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

function currentPermission(): NotificationPermission {
  return typeof Notification === 'undefined' ? 'default' : Notification.permission;
}

export function useNotifications(): NotificationsApi {
  const queryClient = useQueryClient();
  const [platform] = useState(() => detectPlatform());
  const [working, setWorking] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(() => currentPermission());
  const [error, setError] = useState<string | null>(null);

  const state: NotificationState = working
    ? 'working'
    : platform.needsInstallForPush
      ? // iPhone in a Safari tab. Not unsupported, which would be a lie, and not askable either.
        'needs-install'
      : !platform.supportsPush || !platform.supportsNotifications
        ? 'unsupported'
        : vapidPublicKey() === null
          ? // The build has no public key, so a subscription could be created and never signed for.
            'not-configured'
          : permission === 'granted'
            ? 'granted'
            : permission === 'denied'
              ? 'denied'
              : 'default';

  const enable = useCallback(async () => {
    setError(null);
    setWorking(true);

    try {
      const key = vapidPublicKey();
      if (!key) throw new Error('Fastr was built without a notification key.');

      // Requested here, in the same turn as the click, which some browsers require: a permission request made
      // after an await is no longer attributable to a user gesture.
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== 'granted') return;

      const registration = await navigator.serviceWorker.ready;

      // Reuse an existing subscription rather than creating a second one for the same browser.
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          // Required by every browser now; a subscription without it is rejected outright.
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(key),
        }));

      await saveSubscription(subscription);
      await queryClient.invalidateQueries({ queryKey: pushQueryKey });
    } catch (caught) {
      setError(
        caught instanceof Error && /notification key/.test(caught.message)
          ? caught.message
          : 'Notifications could not be turned on for this device. Try again in a moment.',
      );
    } finally {
      setWorking(false);
    }
  }, [queryClient]);

  const disable = useCallback(async () => {
    setError(null);
    setWorking(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // The row goes first. If the order were reversed and the delete failed, the server would keep sending to
        // an endpoint the browser has forgotten, which is a silent leak of notifications into nowhere.
        await deleteSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }

      await queryClient.invalidateQueries({ queryKey: pushQueryKey });
    } catch {
      setError('That did not work. Try again in a moment.');
    } finally {
      setWorking(false);
    }
  }, [queryClient]);

  return { state, error, enable, disable };
}
