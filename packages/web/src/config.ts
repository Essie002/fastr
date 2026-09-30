/**
 * Build-time configuration, validated once.
 *
 * Both values are public by design. The anon key identifies the project and is safe in a bundle and a
 * public repo, because Row Level Security is what keeps one account out of another's rows. Treating
 * it as a secret would only hide it from the person maintaining the project while shipping it to every
 * visitor anyway.
 *
 * Missing configuration fails loudly and immediately. The alternative — an undefined URL reaching the
 * Supabase client — produces a stream of network errors on every screen, which reads as a broken
 * database rather than an unset variable.
 */

export interface Config {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Fastr is not configured: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

export function readConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];

  const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? '';
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

  if (supabaseUrl === '') {
    problems.push('VITE_SUPABASE_URL is not set');
  } else {
    try {
      new URL(supabaseUrl);
    } catch {
      problems.push(`VITE_SUPABASE_URL is not a valid URL: ${supabaseUrl}`);
    }
  }

  if (supabaseAnonKey === '') {
    problems.push('VITE_SUPABASE_ANON_KEY is not set');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return { supabaseUrl, supabaseAnonKey };
}

/** How to fix it, shown on screen rather than only in the console. */
export const CONFIG_HELP = [
  'Locally: run `npm run setup`, which writes packages/web/.env.local for you.',
  'Deployed: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as repository variables.',
];
