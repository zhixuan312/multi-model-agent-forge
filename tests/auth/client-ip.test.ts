// @vitest-environment node
import { resolveClientIp } from '@/auth/client-ip';

/**
 * The per-IP half of the login throttle is only as good as the header it keys on.
 *
 * This used to take the LEFT-MOST `X-Forwarded-For` hop and describe it as "set by the
 * trusted proxy". Under the canonical nginx recipe that header is APPENDED to
 * (`$proxy_add_x_forwarded_for`), so its left-most entry is whatever the CLIENT sent — a
 * fresh value per request means a fresh rate-limit bucket per request.
 */
describe('resolveClientIp (F18)', () => {
  const orig = process.env.FORGE_TRUST_PROXY;
  afterEach(() => {
    process.env.FORGE_TRUST_PROXY = orig;
  });

  it('prefers X-Real-IP over X-Forwarded-For when a proxy is trusted', () => {
    process.env.FORGE_TRUST_PROXY = 'true';
    // The attacker-supplied left-most XFF hop must lose to the proxy-replaced header.
    expect(
      resolveClientIp({ forwardedFor: '1.2.3.4, 203.0.113.7', realIp: '203.0.113.7' }),
    ).toBe('203.0.113.7');
  });

  it('a rotating X-Forwarded-For cannot move the bucket while X-Real-IP is present', () => {
    process.env.FORGE_TRUST_PROXY = 'true';
    const seen = ['9.9.9.9', '8.8.8.8', '7.7.7.7'].map((spoof) =>
      resolveClientIp({ forwardedFor: `${spoof}, 203.0.113.7`, realIp: '203.0.113.7' }),
    );
    expect(new Set(seen).size, 'every request must land in the same counter').toBe(1);
  });

  it('falls back to the left-most XFF hop only when the proxy set no X-Real-IP', () => {
    process.env.FORGE_TRUST_PROXY = 'true';
    expect(
      resolveClientIp({ forwardedFor: '203.0.113.7, 10.0.0.1, 10.0.0.2', realIp: null }),
    ).toBe('203.0.113.7');
  });

  it('with trust-proxy off, ignores XFF entirely', () => {
    process.env.FORGE_TRUST_PROXY = 'false';
    expect(resolveClientIp({ forwardedFor: '203.0.113.7', realIp: '127.0.0.1' })).toBe('127.0.0.1');
  });

  it('falls back to "unknown" when nothing resolves', () => {
    process.env.FORGE_TRUST_PROXY = 'false';
    expect(resolveClientIp({ forwardedFor: null, realIp: null })).toBe('unknown');
    process.env.FORGE_TRUST_PROXY = 'true';
    expect(resolveClientIp({ forwardedFor: null, realIp: null })).toBe('unknown');
  });
});
