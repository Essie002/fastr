/**
 * The home screen: the live timer, the current stage, and water quick-add.
 *
 * A shell for now. Task 13 builds the timer, and task 17 the water controls. What is real here is the
 * heading structure and the landmark, so the routing and accessibility tests have something true to
 * assert against rather than a placeholder that gets replaced wholesale.
 */
export default function Timer() {
  return (
    <div className="stack">
      <h1>Timer</h1>
      <div className="card">
        <p className="muted">
          The timer arrives in task 13, built on the fast&apos;s stored start time so it stays
          correct after a reload and on a second device.
        </p>
      </div>
    </div>
  );
}
