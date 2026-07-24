// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildGeneratedConfig,
  containerConfigSchema,
  resolveOrWriteConfig,
} from '@/mma/container-config';

describe('container MMA config generation', () => {
  it('generates anthropic tiers with only strict-schema fields', () => {
    const cfg = buildGeneratedConfig('anthropic', {
      ANTHROPIC_API_KEY: 'sk-ant',
    });

    expect(containerConfigSchema.parse(cfg)).toEqual({
      agents: {
        main: { type: 'claude', model: 'claude-opus-4-8', apiKeyEnv: 'ANTHROPIC_API_KEY' },
        complex: { type: 'claude', model: 'claude-sonnet-4-5', apiKeyEnv: 'ANTHROPIC_API_KEY' },
        standard: { type: 'claude', model: 'claude-haiku-4-5', apiKeyEnv: 'ANTHROPIC_API_KEY' },
      },
    });
  });

  it('generates keyless OpenAI tiers for OAuth-mode mounts when no API key is present', () => {
    const cfg = buildGeneratedConfig('openai', {});

    expect(containerConfigSchema.parse(cfg)).toEqual({
      agents: {
        main: { type: 'codex', model: 'gpt-5.5' },
        complex: { type: 'codex', model: 'gpt-5.5' },
        standard: { type: 'codex', model: 'gpt-5.5' },
      },
    });
  });

  it('prefers a mounted config path untouched when ~/.mma/config.json already exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-config-'));
    try {
      const mountedDir = join(dir, '.mma');
      mkdirSync(mountedDir, { recursive: true });
      const mountedPath = join(mountedDir, 'config.json');
      writeFileSync(mountedPath, '{"agents":{"main":{"type":"claude","model":"custom"}}}', 'utf8');

      await expect(
        resolveOrWriteConfig({
          provider: 'anthropic',
          homeDir: dir,
          env: { ANTHROPIC_API_KEY: 'sk-ant' },
        }),
      ).resolves.toEqual({
        kind: 'mounted',
        path: mountedPath,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
