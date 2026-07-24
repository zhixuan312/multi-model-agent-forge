// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Docker assets', () => {
  it('uses a multi-stage standalone Docker build with build-time metadata injection', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('FROM node:20-bookworm-slim AS deps');
    expect(dockerfile).toContain('FROM node:20-bookworm-slim AS builder');
    expect(dockerfile).toContain('FROM node:20-bookworm-slim AS runner');
    expect(dockerfile).toContain('ARG FORGE_BUILD_GIT_SHA=unknown');
    expect(dockerfile).toContain('ARG FORGE_BUILD_BUILT_AT=unknown');
    expect(dockerfile).toContain('ENV FORGE_BUILD_GIT_SHA=$FORGE_BUILD_GIT_SHA');
    expect(dockerfile).toContain('ENV FORGE_BUILD_BUILT_AT=$FORGE_BUILD_BUILT_AT');
    expect(dockerfile).toContain('COPY --from=builder /app/.next/standalone ./');
    expect(dockerfile).toContain('ENTRYPOINT ["./docker/entrypoint.sh"]');
    expect(dockerfile).toContain('CMD ["node", "server.js"]');
  });

  it('ships an entrypoint shell that delegates to the bootstrap runner', () => {
    const entrypoint = readFileSync(join(process.cwd(), 'docker', 'entrypoint.sh'), 'utf8');

    expect(entrypoint).toContain('#!/bin/sh');
    expect(entrypoint).toContain('set -eu');
    expect(entrypoint).toContain('exec node /app/scripts/container-bootstrap.mjs "$@"');
  });
});
