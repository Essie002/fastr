/**
 * Sign in, password reset, and invite acceptance.
 *
 * A shell. Task 10 builds it, against Supabase Auth with invite-only sign-up. It sits outside the app
 * shell, because a signed-out visitor has no use for navigation to five screens they cannot open.
 */
export default function SignIn() {
  return (
    <div
      className="stack"
      style={{ maxWidth: '24rem', margin: '0 auto', padding: 'var(--space-6)' }}
    >
      <h1>Fastr</h1>
      <div className="card">
        <p className="muted">
          Sign in arrives in task 10. Fastr is invite-only, so accounts are created by invitation
          rather than by signing up here.
        </p>
      </div>
    </div>
  );
}
