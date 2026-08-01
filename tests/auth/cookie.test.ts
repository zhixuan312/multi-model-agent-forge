// @vitest-environment node
import {
  mintSessionToken,
  hashToken,
  sessionCookieOptions,
  clearedCookieOptions,
  secureCookieWillBeDropped,
  SESSION_COOKIE_NAME,
} from '@/auth/cookie';
import { COOKIE_SAMESITE, SESSION_ABSOLUTE_TTL_MS } from '@/auth/config';

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

  it('takes SameSite from COOKIE_SAMESITE — the declared CSRF control, not a copy of it', () => {
    // SameSite=Lax is what stops a cross-site POST carrying the session, which is why only
    // a handful of mutating routes add an explicit origin check on top. The value used to be
    // hardcoded here while `COOKIE_SAMESITE` sat unused, so changing the documented control
    // would have had no effect. Assert they are the SAME value, not merely both 'lax'.
    expect(sessionCookieOptions({ secure: false }).sameSite).toBe(COOKIE_SAMESITE);
    expect(clearedCookieOptions({ secure: false }).sameSite).toBe(COOKIE_SAMESITE);
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

/**
 * The silent-login-loop detector: production defaults the session cookie to
 * `Secure`, and a browser on plain HTTP throws that cookie away — login succeeds
 * server-side and the user still lands back on /login with no error. The check
 * has to fire on exactly that case and stay quiet everywhere else, or the warning
 * becomes noise an operator learns to ignore.
 */
describe('secureCookieWillBeDropped', () => {
  it('fires when a Secure cookie is served over plain HTTP (the silent login loop)', () => {
    expect(secureCookieWillBeDropped({ secure: true, forwardedProto: 'http' })).toBe(true);
    expect(secureCookieWillBeDropped({ secure: true, origin: 'http://203.0.113.9:3000' })).toBe(true);
    expect(secureCookieWillBeDropped({ secure: true, referer: 'http://forge.example.com/login' })).toBe(true);
  });

  it('reads the FIRST X-Forwarded-Proto hop (the browser-facing one)', () => {
    expect(secureCookieWillBeDropped({ secure: true, forwardedProto: 'http, https' })).toBe(true);
    expect(secureCookieWillBeDropped({ secure: true, forwardedProto: 'https, http' })).toBe(false);
  });

  it('prefers X-Forwarded-Proto over the Origin scheme (TLS terminates at the proxy)', () => {
    // The proxy speaks https to the browser and plain http to Forge — not a defect.
    expect(
      secureCookieWillBeDropped({ secure: true, forwardedProto: 'https', origin: 'http://internal:3000' }),
    ).toBe(false);
  });

  it('stays quiet when the cookie is not Secure', () => {
    expect(secureCookieWillBeDropped({ secure: false, forwardedProto: 'http' })).toBe(false);
  });

  it('stays quiet on https', () => {
    expect(secureCookieWillBeDropped({ secure: true, origin: 'https://forge.example.com' })).toBe(false);
  });

  it('stays quiet on localhost — browsers accept Secure cookies from a secure context', () => {
    expect(secureCookieWillBeDropped({ secure: true, origin: 'http://localhost:3000' })).toBe(false);
    expect(secureCookieWillBeDropped({ secure: true, origin: 'http://127.0.0.1:3000' })).toBe(false);
  });

  it('stays quiet when no header reveals the scheme (never guess)', () => {
    expect(secureCookieWillBeDropped({ secure: true })).toBe(false);
    expect(secureCookieWillBeDropped({ secure: true, forwardedProto: '', origin: null, referer: null })).toBe(false);
  });

  it('stays quiet on a malformed origin rather than crashing the login path', () => {
    expect(secureCookieWillBeDropped({ secure: true, origin: 'not a url' })).toBe(false);
  });
});
