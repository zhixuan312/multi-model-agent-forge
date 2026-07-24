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

  it('generates a MIXED claude/codex layout via per-tier provider overrides', () => {
    // The real-world shape: standard=claude, complex=codex, main=claude. Each tier
    // must carry its OWN provider's key env var — a single PROVIDER cannot express this.
    const cfg = buildGeneratedConfig('anthropic', {
      PROVIDER_COMPLEX: 'openai',
      MODEL_STANDARD: 'claude-haiku-4-5',
      MODEL_COMPLEX: 'gpt-5.4',
      MODEL_MAIN: 'claude-opus-4-8',
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENAI_API_KEY: 'sk-oai',
    });

    expect(containerConfigSchema.parse(cfg)).toEqual({
      agents: {
        main: { type: 'claude', model: 'claude-opus-4-8', apiKeyEnv: 'ANTHROPIC_API_KEY' },
        complex: { type: 'codex', model: 'gpt-5.4', apiKeyEnv: 'OPENAI_API_KEY' },
        standard: { type: 'claude', model: 'claude-haiku-4-5', apiKeyEnv: 'ANTHROPIC_API_KEY' },
      },
    });
  });

  it('gives each tier only its own provider key, so a half-configured mix stays keyless', () => {
    // Only the Anthropic key is supplied; the codex tier must NOT borrow it — it
    // falls back to codex OAuth instead.
    const cfg = buildGeneratedConfig('anthropic', {
      PROVIDER_COMPLEX: 'openai',
      ANTHROPIC_API_KEY: 'sk-ant',
    });

    expect(cfg.agents.complex).toEqual({ type: 'codex', model: 'gpt-5.5' });
    expect(cfg.agents.main.apiKeyEnv).toBe('ANTHROPIC_API_KEY');
  });

  it('supports a per-tier base URL for OpenAI-compatible endpoints', () => {
    const cfg = buildGeneratedConfig('openai', {
      BASE_URL_STANDARD: 'https://self-hosted.example/v1',
      OPENAI_API_KEY: 'sk-oai',
    });

    expect(cfg.agents.standard).toEqual({
      type: 'codex',
      model: 'gpt-5.5',
      baseUrl: 'https://self-hosted.example/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
    });
  });

  it('rejects an unknown per-tier provider instead of silently defaulting', () => {
    expect(() => buildGeneratedConfig('anthropic', { PROVIDER_MAIN: 'gemini' })).toThrow(/Unknown provider "gemini"/);
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
          // Hermetic: tests/setup.ts loads .env, which sets MMA_CONFIG_PATH. That env
          // var legitimately outranks homeDir at runtime, so it must be neutralised here
          // or this test asserts against the developer's ambient config path.
          configPathEnv: '',
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
