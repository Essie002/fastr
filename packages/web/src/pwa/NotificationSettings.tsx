import { useQuery } from '@tanstack/react-query';
import { describeDevice, fetchSubscriptions, pushQueryKey } from '../data/push.js';
import { useNotifications } from './useNotifications.js';

/**
 * Letting this device receive notifications. Requirements 7.2, 7.12, 7.13.
 *
 * Separate from the preferences above it in settings, and the distinction is worth stating in the UI: those decide
 * *what* gets queued for the account, this decides whether *this* device is allowed to show it. Someone with
 * notifications on and no subscribed device gets nothing, and without the separation that looks like a bug.
 */
export function NotificationSettings() {
  const { state, error, enable, disable } = useNotifications();
  const subscriptions = useQuery({ queryKey: pushQueryKey, queryFn: fetchSubscriptions });

  return (
    <section className="card stack" aria-labelledby="devices-heading">
      <h2 id="devices-heading">This device</h2>

      {state === 'needs-install' && (
        <>
          <p className="muted">
            On iPhone and iPad, Apple only allows notifications from an app that has been added to
            the home screen. Add Fastr there first, open it from the home screen, and this will
            work.
          </p>
          <ol className="install__steps">
            <li>Tap the Share button in Safari.</li>
            <li>Choose &ldquo;Add to Home Screen&rdquo;.</li>
            <li>Open Fastr from your home screen and come back here.</li>
          </ol>
        </>
      )}

      {state === 'unsupported' && (
        <p className="muted">
          This browser cannot show notifications. Fastr will still show you an alert while it is
          open.
        </p>
      )}

      {state === 'not-configured' && (
        <p className="muted">
          This build of Fastr has no notification key, so push is unavailable. See the README on
          generating VAPID keys.
        </p>
      )}

      {state === 'denied' && (
        <p className="muted">
          Notifications are blocked for Fastr. A page cannot ask again once blocked, so this has to
          be changed in your browser: open the padlock or site settings next to the address, and set
          notifications to Allow.
        </p>
      )}

      {(state === 'default' || state === 'working') && (
        <>
          <p className="muted">
            Fastr will tell you when a fast reaches its goal, even when the app is closed.
          </p>
          <button
            type="button"
            className="button button--primary"
            disabled={state === 'working'}
            onClick={() => void enable()}
          >
            {state === 'working' ? 'Turning on…' : 'Turn on notifications'}
          </button>
        </>
      )}

      {state === 'granted' && (
        <>
          <p role="status">Notifications are on for this device.</p>
          <TestNotificationButton />
          <button type="button" className="button button--secondary" onClick={() => void disable()}>
            Turn off on this device
          </button>
        </>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {(subscriptions.data?.length ?? 0) > 0 && (
        <details>
          <summary className="water__summary">
            {subscriptions.data!.length} device
            {subscriptions.data!.length === 1 ? '' : 's'} can receive notifications
          </summary>
          <ul className="devices">
            {subscriptions.data!.map((subscription) => (
              <li key={subscription.id}>
                <span>{describeDevice(subscription.userAgent)}</span>
                <span className="muted">
                  {subscription.lastOkAt
                    ? `last notified ${new Intl.DateTimeFormat('en-GB', {
                        day: 'numeric',
                        month: 'short',
                      }).format(new Date(subscription.lastOkAt))}`
                    : 'not notified yet'}
                  {/* Surfaced because a persistently failing subscription is otherwise invisible: the user
                      simply stops getting notifications on one device and has no way to tell. */}
                  {subscription.failures > 0 && ` · ${subscription.failures} recent failures`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * Requirement 7.13.
 *
 * Shown locally through the service worker registration rather than sent through a push service, because this
 * question is "can this device display a notification", and routing it through the server would make a failure
 * ambiguous between permission, subscription and delivery. End-to-end delivery is checked against the hosted
 * project, as the README says.
 */
function TestNotificationButton() {
  return (
    <button
      type="button"
      className="button button--secondary"
      onClick={() => {
        void navigator.serviceWorker.ready.then((registration) =>
          registration.showNotification('Fastr', {
            body: 'Notifications are working on this device.',
            icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
            tag: 'fastr-test',
          }),
        );
      }}
    >
      Send a test notification
    </button>
  );
}
