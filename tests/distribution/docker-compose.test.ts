// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('docker-compose topology', () => {
  it('runs a single all-in-one forge service with a workspace-base volume', () => {
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8');

    expect(compose).toContain('forge:');
    expect(compose).toContain('forge-net:');
    expect(compose).toContain('forge-workspace:');
    expect(compose).toContain('- forge-workspace:/workspace');
    expect(compose).toContain('DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL}');
    // No separate MMA service — the engine is bundled inside the forge image.
    expect(compose).not.toMatch(/^ {2}mma:/m);
  });

  it('bundles the MMA engine — no separate service or external bearer/URL wiring', () => {
    // The engine runs on loopback inside the container and writes its bearer to the
    // baked MMA_HOME (/home/node); reachability, token, and workspace file identity are
    // all internal, so the compose sets no MMA_BASE_URL / MMA_HOME / MMA_AUTH_TOKEN and
    // mounts no shared mma-home volume.
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8');

    expect(compose).not.toContain('MMA_BASE_URL');
    expect(compose).not.toContain('MMA_AUTH_TOKEN');
    expect(compose).not.toContain('mma-home');
  });

  it('passes the full per-tier provider contract through to the container', () => {
    // The generator supports mixed claude/codex layouts via PROVIDER_<TIER>; if these
    // are not forwarded, that capability is unreachable from the shipped topology.
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8');

    for (const tier of ['STANDARD', 'COMPLEX', 'MAIN']) {
      expect(compose).toContain(`PROVIDER_${tier}: \${PROVIDER_${tier}:-}`);
      expect(compose).toContain(`MODEL_${tier}: \${MODEL_${tier}:-}`);
      expect(compose).toContain(`BASE_URL_${tier}: \${BASE_URL_${tier}:-}`);
      expect(compose).toContain(`API_KEY_ENV_${tier}: \${API_KEY_ENV_${tier}:-}`);
    }
    expect(compose).toContain('ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}');
    expect(compose).toContain('OPENAI_API_KEY: ${OPENAI_API_KEY:-}');
  });

  it('keeps Postgres optional and avoids in-compose TLS termination', () => {
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8');

    expect(compose).toContain('postgres:');
    expect(compose).toContain('profiles: ["postgres"]');
    expect(compose).not.toMatch(/caddy|traefik|nginx/i);
  });
});
