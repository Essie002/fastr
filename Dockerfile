# Fastr's web app as a container. Requirement 20.5.
#
# Not how Fastr is deployed — GitHub Pages serves the same build as static files — so this is here for two narrower
# reasons. It is the answer to "can I run this somewhere other than Pages" without a redesign, and CI builds it on
# every run, so the answer cannot quietly rot.
#
# Works with Docker and with Podman: `podman build -t fastr .` needs no changes.

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM docker.io/library/node:22-alpine AS build

WORKDIR /app

# Manifests first, so a source-only change reuses the installed layer. The workspace package files have to come along
# too, or `npm ci` cannot resolve the workspaces the lockfile describes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/web/package.json ./packages/web/

# `ci` rather than `install`: the lockfile is authoritative, so the image cannot drift from a developer's machine.
RUN npm ci

COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages

# The Supabase URL and anon key are baked in at build time by Vite, which means they are build arguments rather than
# runtime environment. Both are public by design — the anon key is protected by Row Level Security — so there is
# nothing secret being embedded in a layer here.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_VAPID_PUBLIC_KEY

# Shared first, explicitly, then web.
#
# The web package's `tsc -b` needs the shared package's emitted declarations, and on a clean checkout they do not exist
# yet. `npm run build --workspaces` was not enough — it does not reliably order these two — so the order is stated here
# rather than assumed. The failure it avoids is TS6305 on every file that imports @fastr/shared, which appears only on
# a clean tree and so passes on any machine that has run a build before.
RUN npm run build --workspace @fastr/shared \
 && npm run build --workspace @fastr/web

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM docker.io/library/nginx:1.27-alpine AS runtime

# nginx's own unprivileged image variant would also do; this keeps the base image common and does the same thing by
# hand, so the reason is visible.
RUN addgroup -g 10001 -S fastr && adduser -u 10001 -S fastr -G fastr

COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Three adjustments so nginx can run as a non-root user.
#
# The pid path is rewritten in the main config rather than passed with `-g`, because the base config already sets one
# and nginx refuses to start with "pid directive is duplicate". Its default, /run/nginx.pid, is root-owned.
#
# The `user` directive is removed because it is meaningless once the process is not root, and nginx warns about it on
# every start, which trains people to ignore its warnings.
RUN sed -i 's|^pid .*|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
 && sed -i '/^user /d' /etc/nginx/nginx.conf \
 && mkdir -p /var/cache/nginx \
 && chown -R fastr:fastr /var/cache/nginx /usr/share/nginx/html

USER fastr

# 8080 rather than 80: binding a port below 1024 needs root or an added capability, and the point of the non-root user
# is not to need either.
EXPOSE 8080

# Requirement 20.2. A health check that asks for a real file, so a container whose assets failed to copy is reported
# unhealthy rather than merely listening.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/fastr/index.html || exit 1

CMD ["nginx", "-g", "daemon off;"]
