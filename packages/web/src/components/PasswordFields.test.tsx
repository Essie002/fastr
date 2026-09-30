import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH, describePasswordProblem } from './PasswordFields.js';

describe('describePasswordProblem (Req 1.3)', () => {
  it('rejects a password one character too short', () => {
    expect(
      describePasswordProblem(
        'a'.repeat(MIN_PASSWORD_LENGTH - 1),
        'a'.repeat(MIN_PASSWORD_LENGTH - 1),
      ),
    ).toMatch(/at least 10 characters/i);
  });

  it('accepts one at exactly the minimum', () => {
    const password = 'a'.repeat(MIN_PASSWORD_LENGTH);
    expect(describePasswordProblem(password, password)).toBeNull();
  });

  it('reports a mismatch', () => {
    expect(describePasswordProblem('correct-horse-battery', 'correct-horse-bettery')).toMatch(
      /do not match/i,
    );
  });

  it('reports the length before the mismatch', () => {
    // Length is the fixable fact; a mismatch on a too-short password is noise.
    expect(describePasswordProblem('short', 'different')).toMatch(/at least/i);
  });

  it('matches the minimum configured in Supabase', () => {
    // supabase/config.toml sets minimum_password_length. If they disagree, the form accepts a password
    // the server then rejects with a less helpful message.
    expect(MIN_PASSWORD_LENGTH).toBe(10);
  });
});
