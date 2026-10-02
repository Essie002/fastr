import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
import { AuthProvider } from './auth/AuthProvider.js';
import { ThemeProvider } from './theme/ThemeProvider.js';
import { createQueryClient } from './data/queryClient.js';
import { CONFIG_HELP, ConfigError, readConfig } from './config.js';
// Rounded, friendly type. Self-hosted rather than fetched from a CDN: Fastr is offline-first and
// installable, and a font that needs the network would leave the installed app rendering in Helvetica
// on exactly the mornings it is most likely to be opened without a connection.
import '@fontsource/baloo-2/700.css';
import '@fontsource/baloo-2/800.css';
import '@fontsource-variable/nunito';
import './styles/global.css';

/**
 * Mounts the app.
 *
 * Configuration is read here, before anything else, and a failure is rendered rather than thrown into
 * the console. An unconfigured build otherwise shows a white page with an error only a developer would
 * think to look for, which is the least useful failure available.
 */

const root = document.getElementById('root');
if (!root) throw new Error('No #root element. index.html and main.tsx have diverged.');

function renderFatal(title: string, problems: string[]) {
  createRoot(root!).render(
    <div className="fatal">
      <h1>{title}</h1>
      <ul>
        {problems.map((problem) => (
          <li key={problem}>
            <code>{problem}</code>
          </li>
        ))}
      </ul>
      <h2>How to fix it</h2>
      <ul>
        {CONFIG_HELP.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>,
  );
}

try {
  readConfig(import.meta.env as unknown as Record<string, string | undefined>);

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={createQueryClient()}>
        <ThemeProvider>
          {/*
            The basename matches Vite's `base`. Both are needed and they do different jobs: `base`
            prefixes the asset URLs, `basename` prefixes the routes. With only one of them, either the
            app loads with no styles or every link 404s, and each looks like a different bug.
          */}
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            {/* Inside the router, because the route guard reads the session and the auth screens
                navigate on success. */}
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
} catch (error) {
  if (error instanceof ConfigError) {
    renderFatal('Fastr is not configured', error.problems);
  } else {
    throw error;
  }
}
