// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Docker assets', () => {
  it('uses a multi-stage standalone Node 22 build with build-time metadata injection', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('FROM node:22-bookworm-slim AS deps');
    expect(dockerfile).toContain('FROM node:22-bookworm-slim AS deps-prod');
    expect(dockerfile).toContain('FROM node:22-bookworm-slim AS builder');
    expect(dockerfile).toContain('FROM node:22-bookworm-slim AS runner');
    expect(dockerfile).toContain('ARG FORGE_BUILD_GIT_SHA=unknown');
    expect(dockerfile).toContain('ARG FORGE_BUILD_BUILT_AT=unknown');
    expect(dockerfile).toContain('ENV FORGE_BUILD_GIT_SHA=$FORGE_BUILD_GIT_SHA');
    expect(dockerfile).toContain('ENV FORGE_BUILD_BUILT_AT=$FORGE_BUILD_BUILT_AT');
    expect(dockerfile).toContain('COPY --from=builder /app/.next/standalone ./');
  });

  it('bundles the MMA engine pinned at matchedMmaVersion and runs it under tini via the supervisor', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');

    // The engine is vendored at package.json#matchedMmaVersion — never @latest — and
    // run as a loopback co-process by the supervisor, under tini as PID 1.
    expect(dockerfile).toContain('matchedMmaVersion');
    expect(dockerfile).toContain('npm install -g "@zhixuan92/multi-model-agent@${MMA_VERSION}"');
    expect(dockerfile).toContain('container-supervisor.mjs');
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/entrypoint.sh"]');
    // The supervisor owns `node server.js`, so there is no top-level CMD.
    expect(dockerfile).not.toContain('CMD ["node", "server.js"]');
  });

  it('runs non-root with a liveness healthcheck', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('/api/version');
  });

  it('ships an entrypoint shell that delegates to the supervisor', () => {
    const entrypoint = readFileSync(join(process.cwd(), 'docker', 'entrypoint.sh'), 'utf8');

    expect(entrypoint).toContain('#!/bin/sh');
    expect(entrypoint).toContain('set -eu');
    expect(entrypoint).toContain('exec node /app/scripts/container-supervisor.mjs "$@"');
  });
});
