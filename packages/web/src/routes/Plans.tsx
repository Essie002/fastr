import { PLANS } from '@fastr/shared';

/**
 * The plan catalog. Requirement 4.
 *
 * Reading from the shared plan list already, rather than waiting for task 12, because it costs nothing
 * and it proves the shared package resolves from the web bundle. Choosing a plan, the custom control
 * and the extended-fast notice are task 12.
 */
export default function Plans() {
  return (
    <div className="stack">
      <h1>Plans</h1>
      <p className="muted">
        Pick the one that fits your day. You can change it whenever you like, and it never affects a
        fast already running.
      </p>

      <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
        {PLANS.map((plan) => (
          <li className="card" key={plan.id}>
            <h2>
              {plan.label}
              {plan.extended && (
                <span className="muted" style={{ fontWeight: 400 }}>
                  {' '}
                  — extended fast
                </span>
              )}
            </h2>
            <p className="muted">{plan.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
