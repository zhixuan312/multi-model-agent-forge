// @vitest-environment node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
    // The codex CLI is bundled alongside MMA, pinned at package.json#matchedCodexVersion.
    // MMA's codex provider spawns the `codex` binary, so without it a codex-protocol tier
    // verifies but every task dies with `codex_not_installed`.
    expect(dockerfile).toContain('matchedCodexVersion');
    expect(dockerfile).toContain('"@openai/codex@${CODEX_VERSION}"');
    expect(dockerfile).toContain('container-supervisor.mjs');
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/entrypoint.sh"]');
    // The supervisor owns `node server.js`, so there is no top-level CMD.
    expect(dockerfile).not.toContain('CMD ["node", "server.js"]');
  });

  it('vendors pnpm at build time so first boot downloads nothing', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');

    // The bootstrap runs `pnpm db:migrate`/`db:seed-templates` at container START.
    // Without a build-time prepare, corepack fetches the pnpm tarball from the npm
    // registry right then — fatal on an air-gapped host.
    expect(dockerfile).toContain('corepack prepare "pnpm@${PNPM_VERSION}" --activate');
    // Pinned from package.json#packageManager, never a literal that can drift.
    expect(dockerfile).toContain("require('./package.json').packageManager");
    // A shared cache: the build runs as root, the container runs as `node`, and
    // corepack's default cache is per-user — a per-user cache would miss and re-download.
    expect(dockerfile).toContain('ENV COREPACK_HOME=/usr/local/share/corepack');
    // Proven offline for the runtime user at build time.
    expect(dockerfile).toContain('COREPACK_ENABLE_NETWORK=0 pnpm --version');
  });

  it('reconciles the MMA skill manifest at build time (no boot-time drift WARN)', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('mma sync-skills --target=codex');
    // Synced into the RUNTIME user's home — root's home is not what `mma serve` reads.
    expect(dockerfile).toContain('HOME=/home/node mma sync-skills');

    // ~/.mma is a mounted volume, so an UPGRADED container can inherit a stale
    // manifest the build-time sync never sees. The supervisor re-reconciles (locally,
    // no network) before `mma serve` reads it.
    const supervisor = readFileSync(join(process.cwd(), 'scripts', 'container-supervisor.mjs'), 'utf8');
    expect(supervisor).toContain("'sync-skills', '--target=codex'");
    expect(supervisor).toContain('await reconcileSkillManifest();');
  });

  it('documents the multi-arch buildx push and pins no CPU architecture', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');

    // 0.1.1 shipped arm64-only and would not pull on any x86_64 server.
    expect(dockerfile).toContain('--platform linux/amd64,linux/arm64');
    // Puppeteer must not fetch a host-arch browser; the image uses apt's Chromium.
    expect(dockerfile).toContain('ENV PUPPETEER_SKIP_DOWNLOAD=true');
    expect(dockerfile).toContain('ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium');
    // No stage pins a platform — that would defeat the cross-build.
    expect(dockerfile).not.toMatch(/FROM\s+--platform=/);
  });

  it('runs non-root with a liveness healthcheck', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('/api/version');
  });

  /**
   * The compose file's OAuth example is copy-paste guidance, so it has to be the guidance
   * the other two files give. It showed `${HOME}/.claude:/home/node/.claude:ro` — a
   * DIRECTORY, read-only — which DEPLOYMENT.md §5a and the Dockerfile's own comment both
   * warn against, for two reasons that each fail silently:
   *   - a directory mount shadows the image's pre-synced `~/.codex/skills`, so the
   *     `skill manifest drift detected` warning the build-time sync exists to remove
   *     comes back on every boot;
   *   - `:ro` cannot persist a token refresh, so an always-on server eventually sits on an
   *     expired token and the tier goes "not verified" with nothing logged as an error.
   *
   * Two files said don't; the one an operator actually uncomments showed how.
   */
  it('the compose OAuth example mounts credential files, writable', () => {
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8');
    const oauthLines = compose
      .split('\n')
      .filter((l) => /\.claude|\.codex/.test(l) && l.includes(':/home/node/'));
    expect(oauthLines.length, 'the OAuth example vanished from docker-compose.yml').toBeGreaterThan(0);

    for (const line of oauthLines) {
      expect(line, `directory mount shadows the pre-synced skills dir: ${line.trim()}`)
        .toMatch(/\.(json)\s*:/);
      expect(line, `a read-only mount cannot persist an OAuth refresh: ${line.trim()}`)
        .not.toMatch(/:ro\s*$/);
    }
  });

  /**
   * Exactly ONE container build definition.
   *
   * A `captain-definition` (CapRover) sat beside the Dockerfile carrying a second,
   * divergent build: alpine rather than bookworm, `CMD ["node","server.js"]` with no
   * supervisor and no tini, no MMA engine bundled, and no `db:migrate`/`db:seed-templates`
   * at all — a container that boots Forge against an unmigrated database. It had already
   * stopped being buildable (it copied `src/mock/data`, removed with the mock backend) and
   * named env vars that no longer exist (`MMAGENT_AUTH_TOKEN`, `FORGE_ADMIN_*`, the
   * env-var admin bootstrap `.env.example` says outright does not exist).
   *
   * Nothing referenced it but a comment in next.config.ts. Two build definitions means one
   * of them is not the product, and there is no signal saying which.
   */
  it('has one container build definition, not two', () => {
    const rivals = readdirSync(process.cwd())
      .filter((f) => f === 'captain-definition' || (/^Dockerfile/.test(f) && f !== 'Dockerfile'));
    expect(rivals, 'a second build definition drifts from the one that ships').toEqual([]);
    expect(existsSync(join(process.cwd(), 'Dockerfile'))).toBe(true);
  });

  it('ships an entrypoint shell that delegates to the supervisor', () => {
    const entrypoint = readFileSync(join(process.cwd(), 'docker', 'entrypoint.sh'), 'utf8');

    expect(entrypoint).toContain('#!/bin/sh');
    expect(entrypoint).toContain('set -eu');
    expect(entrypoint).toContain('exec node /app/scripts/container-supervisor.mjs "$@"');
  });
});
