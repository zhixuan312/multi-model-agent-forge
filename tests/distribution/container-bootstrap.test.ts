// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ensureBootOrder } from '../../scripts/container-bootstrap.mjs';

describe('container bootstrap', () => {
  it('runs config ensure, schema create, migrate, seed, then starts the standalone server', async () => {
    const calls: string[] = [];

    await ensureBootOrder({
      databaseUrl: 'postgres://forge:forge@db:5432/forge',
      provider: 'anthropic',
      env: { ANTHROPIC_API_KEY: 'sk-ant' },
      spawnStep: vi.fn(async (label: string) => {
        calls.push(label);
      }),
      // Must return the same shape as the real resolveOrWriteConfig, otherwise the
      // inferred parameter type rejects a void-returning mock.
      ensureConfig: vi.fn(async () => {
        calls.push('ensureConfig');
        return { kind: 'generated', path: '/root/.mma/config.json' };
      }),
      createSchema: vi.fn(async () => {
        calls.push('schema');
      }),
      startServer: vi.fn(async () => {
        calls.push('server');
      }),
    });

    expect(calls).toEqual(['ensureConfig', 'schema', 'db:migrate', 'db:seed-templates', 'server']);
  });

  it('keeps a mounted config untouched while still running the boot sequence', async () => {
    const ensureConfig = vi.fn(async () => ({ kind: 'mounted', path: '/root/.mma/config.json' }));

    await ensureBootOrder({
      databaseUrl: 'postgres://forge:forge@db:5432/forge',
      provider: 'openai',
      env: {},
      spawnStep: vi.fn(async () => undefined),
      ensureConfig,
      createSchema: vi.fn(async () => undefined),
      startServer: vi.fn(async () => undefined),
    });

    expect(ensureConfig).toHaveBeenCalledTimes(1);
  });
});
