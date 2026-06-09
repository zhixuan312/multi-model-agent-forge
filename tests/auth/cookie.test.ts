// @vitest-environment node
import {
  mintSessionToken,
  hashToken,
  sessionCookieOptions,
  clearedCookieOptions,
  SESSION_COOKIE_NAME,
} from '@/auth/cookie';
import { SESSION_ABSOLUTE_TTL_MS } from '@/auth/config';

describe('mintSessionToken', () => {
  it('mints an opaque token with ≥32 bytes of entropy (base64url, no padding)', () => {
    const t = mintSessionToken();
    // base64url of 32 bytes is 43 chars; allow longer
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('mints unique tokens (CSPRNG, not repeating)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(mintSessionToken());
    expect(seen.size).toBe(1000);
  });
});

describe('hashToken', () => {
  it('is deterministic sha256 hex (64 chars)', () => {
    const t = 'a-fixed-token-value';
    const h1 = hashToken(t);
    const h2 = hashToken(t);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(t);
  });

  it('different tokens hash differently', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('sessionCookieOptions', () => {
  it('is httpOnly + SameSite=Lax + Max-Age=SESSION_ABSOLUTE_TTL (seconds) + path=/', () => {
    const opts = sessionCookieOptions({ secure: false });
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.maxAge).toBe(Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000));
    expect(opts.path).toBe('/');
  });

  it('sets Secure when requested (production / FORGE_COOKIE_SECURE=true)', () => {
    expect(sessionCookieOptions({ secure: true }).secure).toBe(true);
  });

  it('leaves Secure off for local-dev http', () => {
    expect(sessionCookieOptions({ secure: false }).secure).toBe(false);
  });

  it('SESSION_COOKIE_NAME is the stable cookie name', () => {
    expect(SESSION_COOKIE_NAME).toBe('forge_session');
  });
});

describe('clearedCookieOptions', () => {
  it('expires the cookie (Max-Age=0)', () => {
    expect(clearedCookieOptions().maxAge).toBe(0);
  });
});
