#!/usr/bin/env node
/**
 * Deploys `packages/web/dist` to Netlify.
 *
 * Why this exists rather than `netlify-cli deploy`: in an npm workspace the CLI reads each package as a
 * candidate site and refuses to act.
 *
 *     We've detected multiple sites inside your repository
 *     Error: Sites detected: @fastr/shared, @fastr/web. Configure the site you want to work with.
 *
 * Passing `--site <id>` does not settle it, and the CLI is unusable outside a TTY besides — run it with
 * stdout redirected and it exits non-zero having printed nothing at all, which is a miserable thing to
 * debug inside a workflow. Netlify's deploy API is three calls and has no heuristics to argue with.
 *
 * Usage: node scripts/deploy-netlify.mjs
 * Needs: NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'packages', 'web', 'dist');

const token = process.env.NETLIFY_AUTH_TOKEN;
const site = process.env.NETLIFY_SITE_ID;

function fail(message) {
  console.error(`deploy failed: ${message}`);
  process.exit(1);
}

if (!token) fail('NETLIFY_AUTH_TOKEN is not set');
if (!site) fail('NETLIFY_SITE_ID is not set');
if (!existsSync(join(dist, 'index.html'))) fail(`no build at ${dist} — run the build first`);

/*
 * The deploy is a zip of the built site with `netlify.toml` at its root.
 *
 * That file normally lives at the repository root, where the CLI finds it. An API deploy has no
 * repository, so the redirects and headers have to travel inside the archive — without it the SPA
 * rewrite is gone, every deep link 404s, and the security headers silently do not exist.
 */
const staging = mkdtempSync(join(tmpdir(), 'fastr-deploy-'));
const archive = join(staging, 'site.zip');

try {
  execFileSync('zip', ['-qr', archive, '.'], { cwd: dist });
  execFileSync('zip', ['-qj', archive, join(root, 'netlify.toml')]);

  const payload = readFileSync(archive);
  console.log(`uploading ${(payload.length / 1024).toFixed(0)} kB`);

  const api = async (path, init = {}) => {
    const response = await fetch(`https://api.netlify.com/api/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) fail(`${path} -> ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  };

  const message = process.env.GITHUB_SHA ?? 'manual';
  let deploy = await api(`/sites/${site}/deploys?title=${encodeURIComponent(message)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: payload,
  });
  console.log(`deploy ${deploy.id} created (${deploy.state})`);

  // Polled to completion rather than trusting the upload. An accepted archive that fails to process
  // leaves the previous version live, and a workflow that reported success would hide that entirely.
  for (let attempt = 0; attempt < 60 && !['ready', 'error'].includes(deploy.state); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    deploy = await api(`/sites/${site}/deploys/${deploy.id}`);
  }

  if (deploy.state !== 'ready') {
    fail(`deploy ended in state "${deploy.state}": ${deploy.error_message ?? 'no message'}`);
  }

  console.log(`live at ${deploy.ssl_url ?? deploy.url}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
