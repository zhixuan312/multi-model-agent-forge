# Node 22 (current LTS) — satisfies engines.node >=20.9.0 and avoids shipping the
# now-EOL Node 20. The Forge container runs only the Next app; the MMA engine is a
# separate process reached over HTTP, so its own Node floor does not bind this image.

# ---- deps: full install (dev + prod) for the build ----
FROM node:22-bookworm-slim AS deps

ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- deps-prod: runtime-only node_modules (no devDeps) ----
# tsx lives in dependencies (the entrypoint's db:migrate/db:seed-templates need it),
# so a --prod install keeps the boot tooling while dropping vitest/eslint/typescript/
# testing-library/etc. This is the node_modules the runner ships.
FROM node:22-bookworm-slim AS deps-prod

ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# ---- builder ----
FROM node:22-bookworm-slim AS builder

ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN corepack enable

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG FORGE_BUILD_GIT_SHA=unknown
ARG FORGE_BUILD_BUILT_AT=unknown
ENV FORGE_BUILD_GIT_SHA=$FORGE_BUILD_GIT_SHA
ENV FORGE_BUILD_BUILT_AT=$FORGE_BUILD_BUILT_AT

# Strip standalone's own traced node_modules: the runner ships the full prod pnpm
# tree (needed for tsx/drizzle/postgres at db:migrate time), and overlaying
# standalone's flattened tree onto the pnpm symlink-farm collides (real dir vs
# symlink, e.g. puppeteer). server.js resolves fine against the prod install.
RUN pnpm build && rm -rf /app/.next/standalone/node_modules

# ---- runner ----
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Non-root home + writable export root (default is <cwd>/.forge-exports, under the
# root-owned /app; pin it to a dir we create and chown for the node user).
ENV HOME=/home/node
ENV FORGE_EXPORT_ROOT=/app/.forge-exports
# Bundled MMA writes its bearer to ~/.mma/auth-token (= /home/node/.mma); point
# Forge's token resolver at the same home so the co-process's token is found.
ENV MMA_HOME=/home/node
# Multi-tenant workspace layout. Forge is multi-team: EACH team gets its own
# workspace root, a validated direct child of the operator BASE (/workspace/<team>),
# set per-team by the org admin in Settings and handed to MMA as that team's ?cwd=.
# So the mounted volume is the BASE holding every team's dir; the bundled MMA (same
# container) sees them all at consistent paths. FORGE_WORKSPACE_ROOT is only the
# fallback root for a team with no path set.
ENV FORGE_WORKSPACE_BASE=/workspace
ENV FORGE_WORKSPACE_ROOT=/workspace/default

RUN apt-get update && apt-get install -y --no-install-recommends \
  chromium \
  ca-certificates \
  fonts-liberation \
  git \
  tini \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxkbcommon0 \
  libxrandr2 \
  xdg-utils \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

# standalone first (it has NO node_modules now — stripped in builder), so its trimmed
# package.json lands before the full one below overwrites it with the real db:* scripts.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/scripts/container-bootstrap.mjs ./scripts/container-bootstrap.mjs
COPY --from=builder /app/scripts/container-supervisor.mjs ./scripts/container-supervisor.mjs
COPY --from=builder /app/docker/entrypoint.sh ./docker/entrypoint.sh
COPY --from=builder /app/src/db ./src/db
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Bundle the MMA engine, pinned to package.json#matchedMmaVersion (the single
# source of truth for the pin — never @latest). The image ships as "Forge <ver>
# containing MMA <matchedMmaVersion>"; the pin advances only when a Forge release
# deliberately adopts and re-tests a newer engine. Installed globally (root) so the
# non-root node user can run the `mma` binary at runtime.
RUN MMA_VERSION="$(node -p "require('./package.json').matchedMmaVersion")" \
  && echo "Bundling MMA engine @${MMA_VERSION}" \
  && npm install -g "@zhixuan92/multi-model-agent@${MMA_VERSION}" \
  && npm cache clean --force

ARG FORGE_BUILD_GIT_SHA=unknown
ARG FORGE_BUILD_BUILT_AT=unknown
ENV FORGE_BUILD_GIT_SHA=$FORGE_BUILD_GIT_SHA
ENV FORGE_BUILD_BUILT_AT=$FORGE_BUILD_BUILT_AT

RUN chmod +x ./docker/entrypoint.sh

# Runtime-writable dirs for the non-root node user. /app is root-owned, so pre-create
# + chown Next's data cache and the export root. /home/node/.mma holds the MMA config
# (the per-tier provider source of truth, managed via Settings → Models) + bearer token;
# pre-create it node-owned so a mounted volume there inits writable and PERSISTS the
# provider config across container recreation.
RUN mkdir -p /app/.next/cache /app/.forge-exports /workspace/default /home/node/.mma \
  && chown -R node:node /app/.next/cache /app/.forge-exports /workspace /home/node/.mma

EXPOSE 3000

USER node

# Liveness on the public build-identity endpoint (Node 22 has global fetch). The
# start-period covers MMA boot + health-gate + DB migrate/seed before Forge serves.
HEALTHCHECK --interval=30s --timeout=5s --start-period=75s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini is PID 1: reaps zombies and forwards signals to the supervisor, which owns
# the MMA + Forge child processes.
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/entrypoint.sh"]
