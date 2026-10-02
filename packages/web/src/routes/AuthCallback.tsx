import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import {
  clearCallbackHash,
  describeCallbackError,
  parseCallbackHash,
} from '../auth/tokensFromUrl.js';

/**
 * Where an emailed link lands. The one route that will turn a URL into a session.
 *
 * Supabase sends invite, sign-up confirmation and recovery links here with the tokens in the fragment. This
 * reads them, adopts the session, records *why* it exists, and forwards accordingly: an invite still needs
 * a name and a password, a recovery link needs a new password, a confirmed sign-up needs to pick a plan,
 * anything else is just a signed-in user.
 *
 * The fragment is read during the first render rather than in an effect. It is a pure read of a value that
 * cannot change under us, and doing it in an effect would mean setting state synchronously from one, which
 * costs an extra render and a lint suppression for no benefit.
 */

type Destination = '/accept-invite' | '/reset-password' | '/plans' | '/' | null;

export default function AuthCallback() {
  const { adoptSession } = useAuth();

  // Captured once. Later renders must not re-read the hash, because the effect below clears it.
  const [parsed] = useState(() => parseCallbackHash(window.location.hash));

  const [destination, setDestination] = useState<Destination>(null);
  const [failed, setFailed] = useState(false);

  // React runs effects twice in development, and this consumes a single-use token: the second run would
  // find the hash already cleared and report a broken link on a link that worked.
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;

    if (parsed.kind !== 'tokens') {
      // An error fragment is already rendered from `parsed`; either way the hash has served its purpose
      // and a consumed token should not sit in the address bar waiting to be replayed on refresh.
      clearCallbackHash();
      return;
    }

    const { accessToken, refreshToken, type } = parsed.tokens;
    const origin = type === 'recovery' ? 'recovery' : type === 'invite' ? 'invite' : 'password';

    void adoptSession(accessToken, refreshToken, origin).then(({ error }) => {
      clearCallbackHash();
      if (error) {
        setFailed(true);
        return;
      }
      setDestination(
        origin === 'invite'
          ? '/accept-invite'
          : origin === 'recovery'
            ? '/reset-password'
            : // A confirmed sign-up already has its name and password; what it does not have is a plan,
              // and the timer is useless without one. Everything else lands on the timer.
              type === 'signup'
              ? '/plans'
              : '/',
      );
    });
  }, [adoptSession, parsed]);

  const message = failed
    ? 'That link did not work. Ask for a new one.'
    : parsed.kind === 'error'
      ? describeCallbackError(parsed.error)
      : null;

  if (message) {
    return (
      <div className="auth">
        <h1 className="auth__title">Fastr</h1>
        <div className="card stack">
          <h2>That link did not work</h2>
          <p role="alert">{message}</p>
          <a className="button button--primary" href={`${import.meta.env.BASE_URL}signin`}>
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  // Someone opened this URL directly, with no fragment at all. Nothing to do and nothing to complain about.
  if (parsed.kind === 'none') return <Navigate to="/" replace />;

  if (destination) return <Navigate to={destination} replace />;

  return (
    <div className="auth">
      <p role="status">Signing you in…</p>
    </div>
  );
}
