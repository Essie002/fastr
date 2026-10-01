import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '@fastr/shared';

/**
 * The alert shown when a fast reaches its goal while the app is open. Requirement 7.10.
 *
 * Independent of push, and necessary rather than duplicative: push notifications are for a closed app, and a
 * browser will not show one for a page that is currently focused. Without this, someone watching the timer reach
 * its goal would see nothing happen.
 *
 * Fires once per fast. Keyed on the fast's id, so ending one and starting another arms it again, while a re-render
 * a second later does not.
 */
export function GoalAlert({
  fastId,
  reachedGoal,
  elapsedMinutes,
  sound,
}: {
  fastId: string;
  reachedGoal: boolean;
  elapsedMinutes: number;
  sound: boolean;
}) {
  const [showing, setShowing] = useState(false);
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!reachedGoal) return;
    if (firedFor.current === fastId) return;
    firedFor.current = fastId;
    setShowing(true);

    if (sound) playChime();
  }, [fastId, reachedGoal, sound]);

  if (!showing) return null;

  return (
    // role="alertdialog" because this interrupts deliberately: it is the moment the user has been waiting for.
    <div className="notice notice--goal" role="alertdialog" aria-labelledby="goal-alert-heading">
      <h2 id="goal-alert-heading">Goal reached</h2>
      <p>You have been fasting for {formatDuration(elapsedMinutes)}.</p>
      <div className="notice__actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => setShowing(false)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * A short two-note chime, synthesised rather than loaded.
 *
 * An audio file would be a binary asset in the repository and another request; this is a dozen lines of
 * oscillator. Wrapped in a try, because an AudioContext can be refused outright — Safari blocks one created
 * without a user gesture, and this plays on a timer rather than on a tap.
 */
function playChime(): void {
  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    const context = new AudioCtor();
    const now = context.currentTime;

    for (const [index, frequency] of [660, 880].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      const start = now + index * 0.18;
      // Ramped rather than switched, because a square-edged gain change clicks.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.24);
    }

    // Closed afterwards: browsers cap how many contexts a page may hold open.
    window.setTimeout(() => void context.close(), 1000);
  } catch {
    // A missing chime is not worth a visible error.
  }
}
