// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('docker-compose topology', () => {
  it('runs forge and mma on one network with one shared workspace volume', () => {
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8');

    expect(compose).toContain('forge:');
    expect(compose).toContain('mma:');
    expect(compose).toContain('forge-net:');
    expect(compose).toContain('mma-workspace:');
    expect(compose).toContain('- mma-workspace:/workspace');
    expect(compose).toContain('FORGE_WORKSPACE_ROOT: /workspace');
    expect(compose).toContain('DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL}');
  });

  it('gives Forge a working MMA bearer source', () => {
    // Forge resolves the bearer from MMA_AUTH_TOKEN, else <MMA_HOME>/.mma/auth-token.
    // Without one of those the whole topology fails at the first MMA call with
    // "MMA bearer not found", so the shared mma-home volume is load-bearing.
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8');

    expect(compose).toContain('MMA_HOME: /mma-home');
    expect(compose).toContain('MMA_AUTH_TOKEN: ${MMA_AUTH_TOKEN:-}');
    expect(compose).toContain('mma-home:/mma-home:ro'); // forge reads
    expect(compose).toContain('- mma-home:/mma-home'); // mma writes
    expect(compose).toContain('HOME: /mma-home'); // makes mma mint the token there
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
