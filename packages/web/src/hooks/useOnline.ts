import { useEffect, useState } from 'react';

/**
 * Whether the browser thinks it has a network.
 *
 * `navigator.onLine` is a low bar: it reports true for a device connected to a router with no route to
 * the internet, so this catches "aeroplane mode" and not "the café wifi wants you to log in". That is
 * the honest limit of what the browser offers without polling something, and it is enough for
 * Requirement 15.4's purpose, which is to explain a failure rather than to predict one. Requests that
 * fail while this says true surface as errors instead.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
