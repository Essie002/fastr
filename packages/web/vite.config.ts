import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Where the app is served from, and the two problems that creates.
 *
 * **It may serve from a subpath.** A GitHub Pages project site lives at `https://<user>.github.io/<repo>/`, and
 * the container image serves under the same prefix, so every asset URL needs it. `base` handles the assets; the
 * router needs a matching `basename` or the paths work and the routes do not.
 *
 * **It may have no server-side routing.** See the `spaFallback` plugin below.
 *
 * The default stays `/fastr/` because that is what Pages, the Dockerfile, the nginx config and CI all expect.
 * A host that serves from the root of its own domain — Netlify, Cloudflare Pages — sets `VITE_BASE_PATH=/`
 * instead. Everything downstream reads `import.meta.env.BASE_URL`, so this is the only place that decides.
 */

const DEFAULT_BASE = '/fastr/';

/** Normalised to a leading and trailing slash, which is what Vite and the router both expect. */
function normaliseBase(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return DEFAULT_BASE;
  if (trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

/**
 * Copies `index.html` to `404.html` after the build.
 *
 * Pages serves `404.html` for any path it cannot find, so making that file the app itself is how a
 * deep link like `/fastr/history` loads at all. Without it, opening a bookmark or refreshing anywhere
 * other than the root returns a genuine 404 page.
 *
 * The response status really is 404, which is invisible to a user and does mean search engines will
 * not index deep links. That is an acceptable trade for a private fasting tracker, and it is the
 * standard approach for a SPA on Pages.
 */
function spaFallback(): Plugin {
  return {
    name: 'fastr-spa-fallback',
    apply: 'build',
    closeBundle() {
      const dist = resolve(import.meta.dirname, 'dist');
      copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'));
    },
  };
}

/**
 * Injects the Content Security Policy, with this build's Supabase origin in `connect-src`.
 *
 * GitHub Pages cannot set HTTP headers, so the policy has to travel in a `<meta>` tag. The origin
 * cannot be hardcoded, because local development, a dev project and production are three different
 * hosts, and a policy naming the wrong one blocks every request with a console error rather than a
 * useful failure.
 *
 * What a meta tag cannot do, recorded here because pretending otherwise is worse than the gap:
 * `frame-ancestors` is ignored in meta form, and `X-Frame-Options` is a header only, so the app can
 * be framed by another site. See the README.
 */
function cspPlugin(supabaseUrl: string): Plugin {
  return {
    name: 'fastr-csp',
    transformIndexHtml(html) {
      let origin = '';
      try {
        origin = new URL(supabaseUrl).origin;
      } catch {
        // No or malformed URL: leave connect-src to 'self' only. The app already refuses to start
        // without a valid URL, so a broken policy here would mask a clearer error.
        origin = '';
      }
      const websocket = origin.replace(/^http/, 'ws');
      const connect = ["'self'", origin, websocket].filter(Boolean).join(' ');

      const policy = [
        "default-src 'self'",
        `connect-src ${connect}`,
        "img-src 'self' data:",
        // React sets inline styles for the progress ring's rotation. Removing this means moving the
        // ring to CSS custom properties, which is a worthwhile follow-up and not a launch blocker.
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "font-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
        "frame-src 'none'",
      ].join('; ');

      return html.replace('%CSP%', policy);
    },
  };
}

export default defineConfig(({ mode }) => {
  // `loadEnv` rather than `process.env`, so `.env.local` written by `npm run setup` is picked up.
  const env = loadEnv(mode, resolve(import.meta.dirname), 'VITE_');

  return {
    base: normaliseBase(env.VITE_BASE_PATH),
    plugins: [react(), cspPlugin(env.VITE_SUPABASE_URL ?? ''), spaFallback()],
    server: { port: 5173 },
    build: {
      // Source maps are off in production: they would publish readable source for an app whose
      // whole security model is that the client is untrusted anyway, but they also triple the
      // deployed size for no benefit here.
      sourcemap: mode !== 'production',
    },
  };
});
