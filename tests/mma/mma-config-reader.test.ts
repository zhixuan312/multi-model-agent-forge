// @vitest-environment node
import { parseMmaTiers } from '@/mma/mma-config-reader';

describe('parseMmaTiers', () => {
  it('maps agents.{tier} → {dialect, model, baseUrl, authMode}', () => {
    const cfg = {
      agents: {
        standard: { type: 'claude', model: 'claude-haiku-4-5' },
        complex: { type: 'codex', model: 'gpt-5.5', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_KEY' },
        main: { type: 'claude', model: 'claude-opus-4-6' },
      },
    };
    expect(parseMmaTiers(cfg)).toEqual({
      main: { dialect: 'claude', model: 'claude-opus-4-6', baseUrl: null, authMode: 'oauth' },
      complex: { dialect: 'codex', model: 'gpt-5.5', baseUrl: 'https://api.openai.com/v1', authMode: 'api-key' },
      standard: { dialect: 'claude', model: 'claude-haiku-4-5', baseUrl: null, authMode: 'oauth' },
    });
  });

  it('returns null for tiers absent from the config', () => {
    expect(parseMmaTiers({ agents: { standard: { type: 'claude', model: 'x' } } })).toEqual({
      main: null,
      complex: null,
      standard: { dialect: 'claude', model: 'x', baseUrl: null, authMode: 'oauth' },
    });
  });

  it('returns all-null for an empty / shapeless config', () => {
    expect(parseMmaTiers({})).toEqual({ main: null, complex: null, standard: null });
    expect(parseMmaTiers(null)).toEqual({ main: null, complex: null, standard: null });
  });
});
