/**
 * Reads the tokens Supabase puts in a link it emails you.
 *
 * An invite or a password-reset link lands on the app with everything in the URL **fragment**:
 *
 *     https://.../fastr/auth/callback#access_token=...&refresh_token=...&type=invite
 *
 * The fragment, not the query string, which matters: a fragment is never sent to a server, so the token
 * cannot end up in an access log or a `Referer` header. It is also why this has to be parsed in the
 * browser rather than handled by a redirect.
 *
 * The Supabase client can do this itself with `detectSessionInUrl`, and that option is deliberately off
 * (see `data/supabase.ts`). With it on, every navigation is inspected for credentials and any route can
 * silently establish a session. Doing it here means exactly one route accepts a token, and this module
 * is the only place to audit.
 */

export type CallbackType = 'invite' | 'recovery' | 'signup' | 'magiclink' | 'email_change';

export interface CallbackTokens {
  accessToken: string;
  refreshToken: string;
  type: CallbackType | null;
}

export interface CallbackError {
  code: string;
  description: string;
}

export type CallbackResult =
  | { kind: 'tokens'; tokens: CallbackTokens }
  | { kind: 'error'; error: CallbackError }
  | { kind: 'none' };

const TYPES: readonly string[] = ['invite', 'recovery', 'signup', 'magiclink', 'email_change'];

/**
 * @param hash `location.hash`, with or without its leading `#`.
 */
export function parseCallbackHash(hash: string): CallbackResult {
  const params = new URLSearchParams(hash.replace(/^#/, ''));

  // Checked before the tokens: an expired link arrives with an error and no tokens, and reporting
  // "nothing here" for it would leave the user staring at a blank screen after clicking a real email.
  const errorCode = params.get('error_code') ?? params.get('error');
  if (errorCode) {
    return {
      kind: 'error',
      error: {
        code: errorCode,
        description: (params.get('error_description') ?? '').replace(/\+/g, ' '),
      },
    };
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return { kind: 'none' };

  const rawType = params.get('type');
  return {
    kind: 'tokens',
    tokens: {
      accessToken,
      refreshToken,
      type: rawType && TYPES.includes(rawType) ? (rawType as CallbackType) : null,
    },
  };
}

/**
 * Removes the fragment from the address bar without adding a history entry.
 *
 * Worth doing for two reasons: a refresh would otherwise replay a consumed token and show a confusing
 * error, and the token would sit in the URL a user might copy to someone else.
 */
export function clearCallbackHash(): void {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

/** A sentence to show the user for the failures a link can actually arrive with. */
export function describeCallbackError(error: CallbackError): string {
  if (/expired/i.test(error.code) || /expired/i.test(error.description)) {
    return 'That link has expired. Ask for a new one.';
  }
  if (/already|used/i.test(error.description)) {
    return 'That link has already been used. Sign in instead, or ask for a new one.';
  }
  return 'That link did not work. Ask for a new one.';
}
