import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { AuthProvider } from '../auth/AuthProvider.js';

/**
 * Renders a component inside the providers the app gives it.
 *
 * A fresh QueryClient per render, with retries off. Sharing one between tests leaks cached data
 * between them, and retries turn a deliberate error case into a three-second wait before the
 * assertion that was going to pass anyway.
 */
export function renderApp(
  ui: ReactNode,
  { route = '/', withAuth = true }: { route?: string; withAuth?: boolean } = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        // Not `gcTime: 0`, which looks like the tidy choice and is a trap: a failed query with no
        // observers is collected the instant it settles, so the next component to mount starts a fresh
        // fetch, which fails, which is collected — and the screen sits in a loading state for ever while
        // the cache shows an error. Cost an hour to find. A fresh client per render already gives the
        // isolation `gcTime: 0` was reaching for.
        gcTime: Infinity,
      },
      mutations: { retry: false },
    },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* MemoryRouter rather than BrowserRouter: jsdom shares one URL across a file, so real history
            leaks the route from one test into the next. */}
        <MemoryRouter initialEntries={[route]}>
          {/* Optional, because a component that reads auth needs the provider, and a test of the
              provider itself must be able to render without one. */}
          {withAuth ? <AuthProvider>{ui}</AuthProvider> : ui}
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );

  return { ...result, queryClient };
}
