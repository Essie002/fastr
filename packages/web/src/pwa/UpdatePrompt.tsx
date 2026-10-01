import { useServiceWorker } from './useServiceWorker.js';

/**
 * Offers a waiting update. Requirement 15.3.
 *
 * Shown, not applied. A page that reloads itself is bad anywhere; here the screen most likely to be open is a
 * running timer, and a reload mid-tap reads as a crash. `role="status"` rather than `alert`, because nothing is
 * wrong — the current version keeps working.
 */
export function UpdatePrompt() {
  const { updateReady, applyUpdate } = useServiceWorker();

  if (!updateReady) return null;

  return (
    <div className="banner banner--offline" role="status">
      <span className="banner__icon" aria-hidden="true">
        ↻
      </span>
      <div>
        A new version of Fastr is ready.{' '}
        <button type="button" className="button button--link" onClick={applyUpdate}>
          Reload to use it
        </button>
      </div>
    </div>
  );
}
