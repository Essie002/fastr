import { STAGES } from '@fastr/shared';
import { Link } from 'react-router-dom';

/**
 * The full stage list, with descriptions. Requirements 6.4 and 6.5.
 *
 * Reached from the timer, so the timer can show the current stage in one line and this can carry the detail.
 *
 * Every description hedges, and the notice at the bottom says where these numbers come from. That is not legal
 * cover: the timings are averages from small studies, several of them in animals, and a tracker that states them
 * flatly is claiming to know something about the reader's body that it cannot.
 */
export function StageDetails({ currentKey }: { currentKey?: string }) {
  return (
    <details className="stages">
      <summary className="stages__summary">All fasting stages</summary>

      <ul className="stages__list">
        {STAGES.map((stage) => (
          <li
            key={stage.key}
            className={
              stage.key === currentKey ? 'stages__item stages__item--current' : 'stages__item'
            }
          >
            <h3 className="stages__name">
              {stage.atMinutes === 0 ? 'From the start' : `From ${stage.atMinutes / 60}h`}:{' '}
              {stage.name}
              {stage.key === currentKey && (
                <span className="plan__badge" style={{ marginLeft: 'var(--space-2)' }}>
                  Now
                </span>
              )}
            </h3>
            <p className="stages__description">{stage.description}</p>
          </li>
        ))}
      </ul>

      <p className="field__hint">
        These timings are averages from a small body of research, some of it in animals, and they
        vary with the person, what they last ate and how active they are. Fastr shows them as a
        guide, not as a measurement of your body. See the <Link to="/settings">health notice</Link>.
      </p>
    </details>
  );
}
