/**
 * What this browser can actually do, as far as installing and notifying go.
 *
 * All of it is detection rather than feature-testing in one case, and that case is iOS. On iPhone,
 * `Notification.requestPermission` is unavailable in a Safari tab and works only once the app has been added to
 * the home screen, from iOS 16.4. There is no feature query that distinguishes "push is unsupported here" from
 * "push is unsupported *until you install this*", so the only way to tell a user the useful thing is to detect
 * the platform. User-agent sniffing is normally the wrong tool; this is the case where it is the only one.
 */

export interface Platform {
  /** Running as an installed app rather than in a browser tab. */
  standalone: boolean;
  isIos: boolean;
  /** Service workers at all. Absent in a private window in some browsers. */
  supportsServiceWorker: boolean;
  supportsPush: boolean;
  supportsNotifications: boolean;
  /**
   * True when notifications are impossible *for now* but would work if installed. iPhone in Safari is the only
   * case, and it is the difference between a useful instruction and a dead button.
   */
  needsInstallForPush: boolean;
}

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;

  // iPadOS 13+ reports itself as a Mac, so the touch-point check is what separates an iPad from a laptop.
  const isIos =
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // Safari's own non-standard flag, which is the only signal on older iOS.
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  const supportsServiceWorker = 'serviceWorker' in navigator;
  const supportsPush = supportsServiceWorker && 'PushManager' in window;
  const supportsNotifications = 'Notification' in window;

  return {
    standalone,
    isIos,
    supportsServiceWorker,
    supportsPush,
    supportsNotifications,
    needsInstallForPush: isIos && !standalone,
  };
}
