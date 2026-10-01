import { useCallback, useEffect, useState } from 'react';

/**
 * Registers the service worker and reports when a new version is waiting.
 *
 * The update is offered rather than applied. Reloading under someone's fingers is bad anywhere and worse here:
 * the one screen they are likely to be looking at is a running timer, and a page that reloads itself mid-tap
 * looks like a crash.
 */

export interface ServiceWorkerState {
  /** A new version is installed and waiting to take over. */
  updateReady: boolean;
  /** Tells the waiting worker to activate, then reloads. */
  applyUpdate: () => void;
}

export function useServiceWorker(): ServiceWorkerState {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Registering from a dev server would cache Vite's module graph and produce confusing stale reloads.
    if (import.meta.env.DEV) return;

    let cancelled = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          `${import.meta.env.BASE_URL}service-worker.js`,
          { scope: import.meta.env.BASE_URL },
        );

        if (cancelled) return;

        // Already waiting when the page loaded: the user has been running an old version in another tab.
        if (registration.waiting) setWaiting(registration.waiting);

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // `controller` is null on the very first install, where there is nothing to update *from* and
            // prompting would be nonsense.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaiting(installing);
            }
          });
        });
      } catch {
        // A failed registration costs offline support and nothing else, so it is not worth telling the user
        // about.
      }
    };

    void register();

    return () => {
      cancelled = true;
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    // The worker calls skipWaiting, then claims the clients; reloading afterwards picks up the new assets.
    waiting.postMessage('skip-waiting');
    waiting.addEventListener('statechange', () => {
      if (waiting.state === 'activated') window.location.reload();
    });
  }, [waiting]);

  return { updateReady: waiting !== null, applyUpdate };
}
