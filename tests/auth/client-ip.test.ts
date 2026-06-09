// @vitest-environment node
import { resolveClientIp } from '@/auth/client-ip';

describe('resolveClientIp (F18)', () => {
  const orig = process.env.FORGE_TRUST_PROXY;
  afterEach(() => {
    process.env.FORGE_TRUST_PROXY = orig;
  });

  it('with trust-proxy on, uses the left-most X-Forwarded-For hop', () => {
    process.env.FORGE_TRUST_PROXY = 'true';
    expect(
      resolveClientIp({ forwardedFor: '203.0.113.7, 10.0.0.1, 10.0.0.2', socketAddr: '10.0.0.9' }),
    ).toBe('203.0.113.7');
  });

  it('with trust-proxy off, uses the socket address (ignores XFF)', () => {
    process.env.FORGE_TRUST_PROXY = 'false';
    expect(resolveClientIp({ forwardedFor: '203.0.113.7', socketAddr: '127.0.0.1' })).toBe('127.0.0.1');
  });

  it('falls back to "unknown" when nothing resolves', () => {
    process.env.FORGE_TRUST_PROXY = 'false';
    expect(resolveClientIp({ forwardedFor: null, socketAddr: null })).toBe('unknown');
  });
});
