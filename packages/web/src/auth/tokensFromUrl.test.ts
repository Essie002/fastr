import { describe, expect, it } from 'vitest';
import { describeCallbackError, parseCallbackHash } from './tokensFromUrl.js';

describe('parseCallbackHash', () => {
  it('reads the tokens and type from an invite link', () => {
    const result = parseCallbackHash(
      '#access_token=abc&refresh_token=def&expires_in=3600&token_type=bearer&type=invite',
    );
    expect(result).toEqual({
      kind: 'tokens',
      tokens: { accessToken: 'abc', refreshToken: 'def', type: 'invite' },
    });
  });

  it('reads a recovery link', () => {
    const result = parseCallbackHash('#access_token=abc&refresh_token=def&type=recovery');
    expect(result.kind === 'tokens' && result.tokens.type).toBe('recovery');
  });

  it('works with or without the leading hash', () => {
    const withHash = parseCallbackHash('#access_token=a&refresh_token=b&type=invite');
    const without = parseCallbackHash('access_token=a&refresh_token=b&type=invite');
    expect(without).toEqual(withHash);
  });

  it('reports nothing for an empty fragment', () => {
    // Someone opening the callback URL directly. Not an error, and reporting one would be wrong.
    expect(parseCallbackHash('')).toEqual({ kind: 'none' });
    expect(parseCallbackHash('#')).toEqual({ kind: 'none' });
  });

  it('reports nothing when only one token is present', () => {
    // A session needs both. Adopting with a missing refresh token yields a session that dies in an hour
    // with no way to renew.
    expect(parseCallbackHash('#access_token=abc&type=invite')).toEqual({ kind: 'none' });
    expect(parseCallbackHash('#refresh_token=def&type=invite')).toEqual({ kind: 'none' });
  });

  it('reports an expired link as an error, not as an empty fragment', () => {
    // This is what actually arrives when someone clicks a day-old email, and treating it as "nothing
    // here" would leave them on a blank screen.
    const result = parseCallbackHash(
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(result.kind).toBe('error');
    expect(result.kind === 'error' && result.error.code).toBe('otp_expired');
    expect(result.kind === 'error' && result.error.description).toBe(
      'Email link is invalid or has expired',
    );
  });

  it('prefers the error over any tokens present alongside it', () => {
    const result = parseCallbackHash('#error_code=otp_expired&access_token=abc&refresh_token=def');
    expect(result.kind).toBe('error');
  });

  it('keeps an unrecognised type as null rather than guessing', () => {
    const result = parseCallbackHash('#access_token=a&refresh_token=b&type=something_new');
    expect(result.kind === 'tokens' && result.tokens.type).toBeNull();
  });

  it('handles a missing type', () => {
    const result = parseCallbackHash('#access_token=a&refresh_token=b');
    expect(result.kind === 'tokens' && result.tokens.type).toBeNull();
  });
});

describe('describeCallbackError', () => {
  it('names an expired link', () => {
    expect(describeCallbackError({ code: 'otp_expired', description: '' })).toMatch(/expired/i);
  });

  it('detects expiry from the description too', () => {
    expect(
      describeCallbackError({ code: 'access_denied', description: 'Email link has expired' }),
    ).toMatch(/expired/i);
  });

  it('explains a link that was already used', () => {
    expect(
      describeCallbackError({ code: 'access_denied', description: 'Token has already been used' }),
    ).toMatch(/already been used/i);
  });

  it('falls back to something actionable', () => {
    // Never a raw error code: the user can only ever do one thing about any of these, which is ask for
    // another link.
    expect(describeCallbackError({ code: 'weird_thing', description: '' })).toMatch(
      /ask for a new one/i,
    );
  });
});
