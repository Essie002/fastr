import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider.js';

/**
 * Keeps signed-out visitors out of the app, and returns them to where they were going.
 *
 * The `from` in location state is the point. Without it, a bookmark to `/fastr/history` sends the user to
 * sign-in and then dumps them on the timer, and they have to navigate again — every time their session
 * expires.
 *
 * `replace` on the redirect, so the protected URL does not stay in history: otherwise the browser's back
 * button walks straight from the sign-in screen into a bounce loop.
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    // Rendering nothing rather than a spinner. Reading a stored session is a synchronous read from
    // storage in all but the slowest case, and a spinner that appears for 20ms on every navigation is
    // worse than a frame of nothing.
    return null;
  }

  if (status === 'signedOut') {
    return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
  }

  return <Outlet />;
}
