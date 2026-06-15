// @vitest-environment node
import { resolveMmaClientConfig, readMmaBearer, DEFAULT_MMA_BASE_URL } from '@/mma/client-config';

describe('resolveMmaClientConfig (bearer is the local mma token; never DB-stored)', () => {
  it('uses the DB base URL + provided bearer + main-tier model', () => {
    const cfg = resolveMmaClientConfig({
      settings: { mmaBaseUrl: 'http://mma.internal:7337' },
      mainModel: 'claude-opus-4-8',
      bearer: 'tok-abc',
    });
    expect(cfg.baseUrl).toBe('http://mma.internal:7337');
    expect(cfg.token).toBe('tok-abc');
    expect(cfg.mainModel).toBe('claude-opus-4-8');
  });

  it('falls back to the loopback default when no settings row exists', () => {
    const cfg = resolveMmaClientConfig({
      settings: null,
      mainModel: null,
      bearer: 'tok',
    });
    expect(cfg.baseUrl).toBe(DEFAULT_MMA_BASE_URL);
    expect(cfg.mainModel).toBeNull();
  });

  it('reads MMA_AUTH_TOKEN when no explicit bearer is passed', () => {
    const prev = process.env.MMA_AUTH_TOKEN;
    process.env.MMA_AUTH_TOKEN = 'env-token';
    try {
      const cfg = resolveMmaClientConfig({ settings: null, mainModel: null });
      expect(cfg.token).toBe('env-token');
    } finally {
      if (prev === undefined) delete process.env.MMA_AUTH_TOKEN;
      else process.env.MMA_AUTH_TOKEN = prev;
    }
  });

  it('throws a redacted error when no bearer can be resolved', () => {
    expect(() =>
      resolveMmaClientConfig({ settings: null, mainModel: null, bearer: null }),
    ).toThrow(/MMA bearer/i);
  });
});

describe('readMmaBearer', () => {
  it('prefers MMA_AUTH_TOKEN over the auth-token file (trimmed)', () => {
    const prevTok = process.env.MMA_AUTH_TOKEN;
    const prevHome = process.env.MMA_HOME;
    process.env.MMA_AUTH_TOKEN = '  spaced-token  ';
    process.env.MMA_HOME = '/nonexistent-home-for-test';
    try {
      expect(readMmaBearer()).toBe('spaced-token'); // trimmed, env wins
    } finally {
      if (prevTok === undefined) delete process.env.MMA_AUTH_TOKEN;
      else process.env.MMA_AUTH_TOKEN = prevTok;
      if (prevHome === undefined) delete process.env.MMA_HOME;
      else process.env.MMA_HOME = prevHome;
    }
  });

  it('returns null when neither env nor file provides a token', () => {
    const prevTok = process.env.MMA_AUTH_TOKEN;
    const prevHome = process.env.MMA_HOME;
    delete process.env.MMA_AUTH_TOKEN;
    process.env.MMA_HOME = '/nonexistent-home-for-test';
    try {
      expect(readMmaBearer()).toBeNull();
    } finally {
      if (prevTok === undefined) delete process.env.MMA_AUTH_TOKEN;
      else process.env.MMA_AUTH_TOKEN = prevTok;
      if (prevHome === undefined) delete process.env.MMA_HOME;
      else process.env.MMA_HOME = prevHome;
    }
  });
});
