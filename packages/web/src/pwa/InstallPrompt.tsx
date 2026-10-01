import { useEffect, useState } from 'react';
import { detectPlatform } from './platform.js';

/**
 * An offer to install, and on iPhone the instructions for doing it by hand.
 *
 * Two paths, because the platforms differ in kind rather than in detail. Chromium browsers fire
 * `beforeinstallprompt`, which can be held and replayed from a button of our own. Safari fires nothing and
 * offers no API: the user has to use the Share menu, so the only thing an app can do is say so.
 *
 * On iPhone this is not a nicety. Web Push only works from an installed app there, so for an iPhone user this
 * prompt is the difference between getting notifications and not.
 */

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'fastr.installDismissed';

export function InstallPrompt() {
  const [platform] = useState(() => detectPlatform());
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Held rather than allowed to proceed, so the offer appears where it makes sense instead of as a browser
      // bar over the top of the app on first load.
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // Not worth failing over; the prompt simply reappears next time.
    }
  }

  // Already installed, or told to go away.
  if (platform.standalone || dismissed) return null;

  if (platform.isIos) {
    return (
      <section className="card stack install" aria-labelledby="install-heading">
        <h2 id="install-heading">Add Fastr to your home screen</h2>
        <p className="muted">
          On iPhone and iPad, notifications only work once Fastr has been added to your home screen.
          Apple does not let a website do this for you, so it takes three taps:
        </p>
        <ol className="install__steps">
          <li>Tap the Share button in Safari — the square with an arrow pointing up.</li>
          <li>Scroll down and choose &ldquo;Add to Home Screen&rdquo;.</li>
          <li>Tap Add, then open Fastr from your home screen.</li>
        </ol>
        <button type="button" className="button button--link" onClick={dismiss}>
          Don&apos;t show this again
        </button>
      </section>
    );
  }

  if (!installEvent) return null;

  return (
    <section className="card stack install" aria-labelledby="install-heading">
      <h2 id="install-heading">Install Fastr</h2>
      <p className="muted">
        Add it to your home screen so it opens like an app and can send you notifications.
      </p>
      <div className="notice__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            void installEvent.prompt().then(() => {
              // The event is single-use: once prompted it cannot be replayed, so it is dropped either way.
              setInstallEvent(null);
            });
          }}
        >
          Install
        </button>
        <button type="button" className="button button--secondary" onClick={dismiss}>
          Not now
        </button>
      </div>
    </section>
  );
}
