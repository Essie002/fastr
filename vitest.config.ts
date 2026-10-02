import { defineConfig } from 'vitest/config';

/**
 * One Vitest run across the workspace, with a project per package so each gets the right
 * environment: node for the pure domain logic, jsdom for the web surfaces.
 *
 * The `db` project is separate from `shared` deliberately. Its tests talk to a real local
 * Supabase, so they need a longer timeout and they are the ones that skip locally and fail in
 * CI (see `supabase/tests/`). Keeping them in their own project means `vitest --project shared`
 * is a fast, dependency-free run.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'web',
          root: './packages/web',
          environment: 'jsdom',
          // An explicit origin, because jsdom disables localStorage on an opaque one and the app
          // reads it on every load to apply the theme. Without this, `localStorage` is simply absent
          // and the failure is a confusing "cannot read properties of undefined" in setup rather
          // than anything about origins. The path mirrors the deployed base so anything that reads
          // location sees a realistic URL.
          environmentOptions: { jsdom: { url: 'http://localhost:5173/fastr/' } },
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/test/setup.ts'],
          passWithNoTests: true,
          /*
           * Fixed configuration, so the suite does not read the developer's `packages/web/.env.local`.
           *
           * Vitest is Vite, so it loads that file and `import.meta.env.VITE_SUPABASE_URL` becomes
           * whatever the local stack happens to be. Almost every test installs the Supabase stub and
           * never touches this — but a React effect that fires after a test has cleared the stub falls
           * through to `getSupabase()`, which reads the real config. With a `.env.local` present that
           * silently succeeds; in CI, where there is none, it throws `ConfigError` and fails a test
           * about the iPhone install prompt. The suite passed locally and failed in CI for a reason
           * visible in neither place.
           *
           * `.invalid` is reserved by RFC 2606 and can never resolve, so a client built from this can
           * be created but cannot reach anything — which is the point. The stub is still what every
           * test asserts against; this only removes the machine-dependent fallback.
           */
          env: {
            VITE_SUPABASE_URL: 'http://supabase.invalid',
            VITE_SUPABASE_ANON_KEY: 'test-anon-key-not-a-real-one',
          },
        },
      },
      {
        test: {
          name: 'db',
          root: './supabase',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          // Signing in two users and waiting on Postgres is slower than the default five seconds on
          // a cold stack.
          testTimeout: 30_000,
          // There is one local database, and these suites plant fixtures and clear them between
          // tests. Run in parallel, two files reset each other's rows mid-assertion and the failures
          // look like RLS bugs, which is the most misleading possible outcome for this suite. The
          // honest fix is one file at a time; the alternative, a schema per worker, is a lot of
          // machinery for a suite that takes three seconds.
          fileParallelism: false,
          passWithNoTests: true,
        },
      },
    ],
  },
});
