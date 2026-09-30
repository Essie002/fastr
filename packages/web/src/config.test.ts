import { describe, expect, it } from 'vitest';
import { ConfigError, readConfig } from './config.js';

const valid = {
  VITE_SUPABASE_URL: 'https://abc.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
};

describe('readConfig', () => {
  it('accepts a complete configuration', () => {
    expect(readConfig(valid)).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabaseAnonKey: 'anon-key',
    });
  });

  it('trims surrounding whitespace', () => {
    // A value pasted into a GitHub variable field picks up a trailing newline more often than not, and
    // the resulting failure is a URL that looks correct in the error message.
    const config = readConfig({
      VITE_SUPABASE_URL: '  https://abc.supabase.co \n',
      VITE_SUPABASE_ANON_KEY: ' anon-key ',
    });
    expect(config.supabaseUrl).toBe('https://abc.supabase.co');
    expect(config.supabaseAnonKey).toBe('anon-key');
  });

  it('reports a missing URL', () => {
    expect(() => readConfig({ VITE_SUPABASE_ANON_KEY: 'anon-key' })).toThrow(ConfigError);
  });

  it('reports a missing key', () => {
    expect(() => readConfig({ VITE_SUPABASE_URL: valid.VITE_SUPABASE_URL })).toThrow(ConfigError);
  });

  it('reports both problems at once', () => {
    // One at a time would mean fixing the URL, rebuilding, and only then learning the key is missing.
    try {
      readConfig({});
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).problems).toHaveLength(2);
    }
  });

  it('rejects a URL that is not a URL', () => {
    try {
      readConfig({ ...valid, VITE_SUPABASE_URL: 'abc.supabase.co' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConfigError).problems[0]).toMatch(/not a valid URL/);
    }
  });

  it('treats an empty string as missing', () => {
    expect(() => readConfig({ ...valid, VITE_SUPABASE_ANON_KEY: '   ' })).toThrow(ConfigError);
  });
});
