// @vitest-environment node
import { resolveMmaClientConfig, DEFAULT_MMA_BASE_URL } from '@/mma/client-config';
import type { SecretStore } from '@/secrets/secret-store';

function fakeSecrets(map: Record<string, string>): SecretStore {
  return {
    async get(id) {
      return map[id] ?? null;
    },
    async put() {
      throw new Error('not used');
    },
    async delete() {
      /* noop */
    },
  };
}

describe('resolveMmaClientConfig', () => {
  it('uses the DB base URL + decrypted token + main-tier model', async () => {
    const cfg = await resolveMmaClientConfig({
      settings: { mmaBaseUrl: 'http://mma.internal:7337', mmaTokenRef: 'ref-1' },
      mainModel: 'claude-opus-4-8',
      secrets: fakeSecrets({ 'ref-1': 'tok-abc' }),
    });
    expect(cfg.baseUrl).toBe('http://mma.internal:7337');
    expect(cfg.token).toBe('tok-abc');
    expect(cfg.mainModel).toBe('claude-opus-4-8');
  });

  it('falls back to the loopback default when no team_settings row exists', async () => {
    const cfg = await resolveMmaClientConfig({
      settings: null,
      mainModel: null,
      secrets: fakeSecrets({}),
      devTokenFallback: 'dev-token',
    });
    expect(cfg.baseUrl).toBe(DEFAULT_MMA_BASE_URL);
    expect(cfg.token).toBe('dev-token');
    expect(cfg.mainModel).toBeNull();
  });

  it('uses the dev token fallback when the ref is absent (dev mode)', async () => {
    const cfg = await resolveMmaClientConfig({
      settings: { mmaBaseUrl: 'http://127.0.0.1:7337', mmaTokenRef: null },
      mainModel: null,
      secrets: fakeSecrets({}),
      devTokenFallback: 'env-or-file-token',
    });
    expect(cfg.token).toBe('env-or-file-token');
  });

  it('throws a redacted error when a configured ref is dangling (no dev fallback)', async () => {
    const err = await resolveMmaClientConfig({
      settings: { mmaBaseUrl: 'http://127.0.0.1:7337', mmaTokenRef: 'ghost' },
      mainModel: null,
      secrets: fakeSecrets({}),
      devTokenFallback: null,
    }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/MMA bearer|token/i);
  });
});
