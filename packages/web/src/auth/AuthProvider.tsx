import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '../data/supabase.js';
import { MIN_PASSWORD_LENGTH } from '../components/PasswordFields.js';

/**
 * Holds the session and exposes the handful of auth actions the app needs.
 *
 * `status` is three-valued on purpose. Without a distinct `loading`, the first render of a signed-in
 * user's app sees `session === null` and the route guard bounces them to sign-in before the client has
 * finished reading the stored session — so every reload would flash the sign-in screen.
 */

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

/**
 * Why a session exists, when it came from an emailed link.
 *
 * An invite or recovery link produces a perfectly ordinary session, which is the awkward part: without
 * recording how it arrived, someone who clicks a reset link is simply signed in, and the app has no
 * reason to ask them for a new password. This is the flag the invite and reset screens read.
 */
export type SessionOrigin = 'password' | 'invite' | 'recovery' | null;

/** What `signUp` produced, which is not the same question as whether it failed. */
export type SignUpOutcome =
  /** Confirmations are off: the account exists and the user is already signed in. */
  | { kind: 'signedIn' }
  /** Confirmations are on: the account exists but needs an emailed link before it can be used. */
  | { kind: 'confirmationSent' }
  | { kind: 'error'; message: string };

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  userId: string | null;
  email: string | null;
  origin: SessionOrigin;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    displayName: string,
    timeZone: string,
  ) => Promise<SignUpOutcome>;
  signOut: () => Promise<void>;
  signOutOtherDevices: () => Promise<{ error: string | null }>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  setPassword: (password: string) => Promise<{ error: string | null }>;
  setDisplayName: (displayName: string) => Promise<{ error: string | null }>;
  adoptSession: (
    accessToken: string,
    refreshToken: string,
    origin: Exclude<SessionOrigin, null>,
  ) => Promise<{ error: string | null }>;
  clearOrigin: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Requirement 2.2. One message for every credential failure.
 *
 * Supabase distinguishes an unknown email from a wrong password, and passing that through would let
 * anyone enumerate who has an account. Genuine service problems are not folded in here, because telling
 * a user their password is wrong when the database is unreachable sends them off changing a password
 * that was never the problem.
 */
const GENERIC_CREDENTIALS = 'That email or password is incorrect.';

function describeSignInError(message: string, status?: number): string {
  if (status && status >= 500) return 'Fastr could not reach its server. Try again in a moment.';
  if (/invalid login credentials|invalid credentials/i.test(message)) return GENERIC_CREDENTIALS;
  if (/email not confirmed/i.test(message)) return 'Confirm your email address first.';
  if (/too many requests|rate limit/i.test(message)) {
    // Requirement 2.3. Supabase rate-limits sign-in attempts; saying so is more useful than a
    // generic failure, and it reveals nothing about whether the account exists.
    return 'Too many attempts. Wait a minute and try again.';
  }
  return GENERIC_CREDENTIALS;
}

/**
 * Sign-up failures, in the user's words.
 *
 * Unlike sign-in, this one does say "that address already has an account". It reads like an enumeration
 * leak and it is one — but only because confirmations are off, which makes Supabase itself return
 * `user_already_exists` here. Paraphrasing that into something vague would hide nothing and would leave
 * someone who simply forgot they had registered with no idea what to do. Turning confirmations on closes
 * the leak properly, in the one place it can be closed.
 */
function describeSignUpError(error: {
  message: string;
  // Optional *and* explicitly undefined-able: `exactOptionalPropertyTypes` is on, and Supabase's
  // `AuthError` declares these as `number | undefined` rather than omitting them.
  status?: number | undefined;
  code?: string | undefined;
}): string {
  const { message, status, code } = error;
  if (status && status >= 500) return 'Fastr could not reach its server. Try again in a moment.';
  if (code === 'user_already_exists' || /already registered|already exists/i.test(message)) {
    return 'That email already has an account. Try signing in instead.';
  }
  if (code === 'signup_disabled' || /signups? (are |is )?(not allowed|disabled)/i.test(message)) {
    return 'New accounts are closed at the moment.';
  }
  if (code === 'weak_password' || /should be at least|password.*(weak|short)/i.test(message)) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (/invalid.*email|email.*invalid/i.test(message))
    return 'That does not look like an email address.';
  if (/too many requests|rate limit|over_email_send_rate_limit/i.test(message) || status === 429) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  return 'Fastr could not create that account. Try again in a moment.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [origin, setOrigin] = useState<SessionOrigin>(null);

  useEffect(() => {
    const supabase = getSupabase();
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus(data.session ? 'signedIn' : 'signedOut');
    });

    // Covers a token refresh, a sign-out in another tab, and a session established by the callback
    // route. Without it, signing out in one tab leaves the others believing they are signed in until
    // their next request fails.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      setSession(next);
      setStatus(next ? 'signedIn' : 'signedOut');
      if (event === 'SIGNED_OUT') setOrigin(null);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) return { error: describeSignInError(error.message, error.status) };
    setOrigin('password');
    return { error: null };
  }, []);

  /**
   * Requirement 1.1. Creating an account.
   *
   * The display name and time zone go in `options.data`, which lands in `auth.users.raw_user_meta_data`,
   * which is exactly where the `on_auth_user_created` trigger reads them from to build the profile row.
   * That is the only reason this works without a second write: the client has no insert policy on
   * `profiles` and could not create the row itself.
   *
   * Two outcomes rather than one, because "no error" does not mean "signed in". With email confirmations
   * on, a successful sign-up returns a user and no session, and treating that as success would drop the
   * user on a screen the route guard immediately bounces them off.
   */
  const signUp = useCallback(
    async (email: string, password: string, displayName: string, timeZone: string) => {
      const { data, error } = await getSupabase().auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName, time_zone: timeZone },
          emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}auth/callback`,
        },
      });

      if (error) return { kind: 'error' as const, message: describeSignUpError(error) };
      if (data.session) {
        setOrigin('password');
        return { kind: 'signedIn' as const };
      }
      // A user with no session means a confirmation email went out. Supabase also returns this shape,
      // with an obfuscated user, when the address is already registered and confirmations are on — which
      // is deliberate on their side, and means this branch must not claim the account is new.
      return { kind: 'confirmationSent' as const };
    },
    [],
  );

  const signOut = useCallback(async () => {
    // Requirement 2.5: revoked on the server, not merely cleared locally. `scope: 'local'` would leave
    // the refresh token valid for anyone holding it.
    await getSupabase().auth.signOut();
    setOrigin(null);
  }, []);

  const signOutOtherDevices = useCallback(async () => {
    // Requirement 2.6. Leaves this device signed in and invalidates every other refresh token.
    const { error } = await getSupabase().auth.signOut({ scope: 'others' });
    return { error: error?.message ?? null };
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
      // Must be listed in the project's redirect allow-list, or Supabase refuses and the user gets an
      // email whose link lands nowhere.
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}auth/callback`,
    });
    // Deliberately not surfaced per-address: a different answer for a registered and an unregistered
    // email would turn this form into an account checker. The screen says "if that address has an
    // account" either way.
    return {
      error: error && error.status && error.status >= 500 ? 'Try again in a moment.' : null,
    };
  }, []);

  const setPassword = useCallback(async (password: string) => {
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) {
      if (/should be at least|weak|short/i.test(error.message)) {
        return { error: 'Use at least 10 characters.' };
      }
      if (/same.*password|different from the old/i.test(error.message)) {
        return { error: 'That is already your password. Choose a different one.' };
      }
      return { error: error.message };
    }
    return { error: null };
  }, []);

  const setDisplayName = useCallback(async (displayName: string) => {
    // Stored on the auth user as metadata *and* on the profile row. This writes the metadata half, so a
    // future invite-driven profile creation has a name to use; the profile row is the one the app reads.
    const { error } = await getSupabase().auth.updateUser({ data: { display_name: displayName } });
    return { error: error?.message ?? null };
  }, []);

  const adoptSession = useCallback(
    async (accessToken: string, refreshToken: string, from: Exclude<SessionOrigin, null>) => {
      const { error } = await getSupabase().auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) return { error: error.message };
      setOrigin(from);
      return { error: null };
    },
    [],
  );

  const clearOrigin = useCallback(() => setOrigin(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? null,
      origin,
      signIn,
      signUp,
      signOut,
      signOutOtherDevices,
      requestPasswordReset,
      setPassword,
      setDisplayName,
      adoptSession,
      clearOrigin,
    }),
    [
      status,
      session,
      origin,
      signIn,
      signUp,
      signOut,
      signOutOtherDevices,
      requestPasswordReset,
      setPassword,
      setDisplayName,
      adoptSession,
      clearOrigin,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used inside an AuthProvider.');
  return value;
}
