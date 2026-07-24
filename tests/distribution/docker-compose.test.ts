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

  it('keeps Postgres optional and avoids in-compose TLS termination', () => {
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8');

    expect(compose).toContain('postgres:');
    expect(compose).toContain('profiles: ["postgres"]');
    expect(compose).not.toMatch(/caddy|traefik|nginx/i);
  });
});
