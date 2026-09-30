import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
import { ThemeProvider } from './theme/ThemeProvider.js';
import { createQueryClient } from './data/queryClient.js';
import { CONFIG_HELP, ConfigError, readConfig } from './config.js';
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
            <App />
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
