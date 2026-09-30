import type { ReactNode } from 'react';

/**
 * A short message above the page content: offline, or something failed.
 *
 * `role="status"` with `aria-live="polite"` rather than `role="alert"`. An alert interrupts whatever a
 * screen reader is currently saying, which is right for "your session expired" and wrong for "you are
 * offline" appearing as someone reads their fasting history. Requirement 19.2 asks for announcements at
 * useful moments, not the loudest available ones.
 */
export function Banner({
  kind,
  children,
  icon,
}: {
  kind: 'offline' | 'error';
  children: ReactNode;
  icon?: string;
}) {
  return (
    <div className={`banner banner--${kind}`} role="status" aria-live="polite">
      <span className="banner__icon" aria-hidden="true">
        {icon ?? (kind === 'offline' ? '○' : '!')}
      </span>
      <div>{children}</div>
    </div>
  );
}

/** Shown whenever the device has no network. Requirement 15.4. */
export function OfflineBanner() {
  return (
    <Banner kind="offline">
      You are offline. Your timer keeps running, and anything you change will need a connection.
    </Banner>
  );
}
