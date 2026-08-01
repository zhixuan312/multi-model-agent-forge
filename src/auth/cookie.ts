import { randomBytes, createHash } from 'node:crypto';
import { COOKIE_SAMESITE, SESSION_ABSOLUTE_TTL_MS, SESSION_COOKIE_NAME } from '@/auth/config';

export { SESSION_COOKIE_NAME };

/** Number of CSPRNG bytes in an opaque session token (≥32, Spec 1 Login §3). */
const TOKEN_BYTES = 32;

/**
 * Mint a cryptographically-random opaque session token (raw cookie value).
 * base64url-encoded so it's cookie-safe. Only the sha256 hash is ever stored;
 * this raw value lives only in the client cookie.
 */
export function mintSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * sha256(token) as lowercase hex — what `session.token_hash` stores. Fast hash
 * is correct here: the token is high-entropy CSPRNG, not guessable, so a slow
 * KDF would add latency for zero security gain (F24 — do not harmonize with
 * argon2id).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The subset of Next.js cookie attributes this app sets. */
export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: typeof COOKIE_SAMESITE;
  secure: boolean;
  path: '/';
  maxAge: number;
}

/**
 * Decide whether the `Secure` flag is set (F27). On in production / when
 * `FORGE_COOKIE_SECURE=true`; off for local http://localhost dev so the demo
 * isn't broken by the browser refusing the cookie.
 */
export function shouldUseSecureCookie(): boolean {
  const explicit = process.env.FORGE_COOKIE_SECURE;
  if (explicit !== undefined && explicit.trim() !== '') {
    return explicit.trim().toLowerCase() === 'true';
  }
  return process.env.NODE_ENV === 'production';
}

/**
 * Cookie attributes for the session cookie: httpOnly · conditional Secure ·
 * SameSite=Lax · Max-Age = SESSION_ABSOLUTE_TTL (in seconds, F12) · path=/.
 */
export function sessionCookieOptions(opts?: { secure?: boolean }): SessionCookieOptions {
  return {
    httpOnly: true,
    // SameSite is THE CSRF control (see `COOKIE_SAMESITE`): a cross-site POST does not
    // carry the cookie, so state-changing routes see no session. Read from the constant
    // rather than repeating the literal — the constant documents the control, and a
    // hardcoded copy here meant changing it would have had no effect.
    sameSite: COOKIE_SAMESITE,
    secure: opts?.secure ?? shouldUseSecureCookie(),
    path: '/',
    maxAge: Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000),
  };
}

/** Cookie attributes that clear the session cookie (Max-Age=0). */
export function clearedCookieOptions(opts?: { secure?: boolean }): SessionCookieOptions {
  return { ...sessionCookieOptions(opts), maxAge: 0 };
}

/**
 * The scheme the BROWSER used, as far as the server can tell: the first
 * `X-Forwarded-Proto` hop when a proxy set one, else the scheme of the request's
 * own `Origin`/`Referer`. Returns null when nothing says — the caller must then
 * stay silent rather than guess.
 */
function observedScheme(h: {
  forwardedProto?: string | null;
  origin?: string | null;
  referer?: string | null;
}): 'http' | 'https' | null {
  const proto = h.forwardedProto?.split(',')[0]?.trim().toLowerCase();
  if (proto === 'http' || proto === 'https') return proto;
  for (const raw of [h.origin, h.referer]) {
    const url = raw?.trim();
    if (!url) continue;
    if (url.startsWith('https://')) return 'https';
    if (url.startsWith('http://')) return 'http';
  }
  return null;
}

/** Browsers treat these origins as secure contexts and DO accept `Secure` cookies. */
function isLocalhostOrigin(raw: string | null | undefined): boolean {
  const url = raw?.trim();
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * True when a `Secure` session cookie CANNOT round-trip: the app minted one but
 * the browser reached it over plain HTTP, so the cookie is silently dropped and
 * the user bounces back to `/login` with no error anywhere — server-side login
 * having *succeeded*. This is the single most confusing way a Forge deploy can
 * fail, so the caller logs a pointed hint instead of leaving a silent loop.
 *
 * Conservative by design: it never fires when the transport is https, when the
 * cookie isn't `Secure` in the first place, on a localhost origin (a secure
 * context that accepts `Secure` cookies), or when no header reveals the scheme.
 */
export function secureCookieWillBeDropped(input: {
  secure: boolean;
  forwardedProto?: string | null;
  origin?: string | null;
  referer?: string | null;
}): boolean {
  if (!input.secure) return false;
  if (observedScheme(input) !== 'http') return false;
  return !isLocalhostOrigin(input.origin ?? input.referer);
}

/** The operator-facing remedy attached to the `login.insecure_cookie` warning. */
export const INSECURE_COOKIE_HINT =
  'Login succeeded but the session cookie is marked Secure and this request arrived over plain HTTP, ' +
  'so the browser discarded it and the user is bounced back to /login. ' +
  'Put a TLS-terminating reverse proxy in front of Forge (and have it set X-Forwarded-Proto), ' +
  'or set FORGE_COOKIE_SECURE=false if you deliberately serve plain HTTP.';
