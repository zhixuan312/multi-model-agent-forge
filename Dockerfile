FROM node:20-bookworm-slim AS deps

ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:20-bookworm-slim AS builder

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

RUN pnpm build

FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends \
  chromium \
  ca-certificates \
  fonts-liberation \
  git \
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

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts/container-bootstrap.mjs ./scripts/container-bootstrap.mjs
COPY --from=builder /app/docker/entrypoint.sh ./docker/entrypoint.sh
COPY --from=builder /app/src/db ./src/db
COPY --from=builder /app/tsconfig.json ./tsconfig.json

ARG FORGE_BUILD_GIT_SHA=unknown
ARG FORGE_BUILD_BUILT_AT=unknown
ENV FORGE_BUILD_GIT_SHA=$FORGE_BUILD_GIT_SHA
ENV FORGE_BUILD_BUILT_AT=$FORGE_BUILD_BUILT_AT

RUN chmod +x ./docker/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "server.js"]
