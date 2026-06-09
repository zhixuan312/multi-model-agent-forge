import { randomBytes, createHash } from 'node:crypto';
import { SESSION_ABSOLUTE_TTL_MS, SESSION_COOKIE_NAME } from '@/auth/config';

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
  sameSite: 'lax';
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
    sameSite: 'lax',
    secure: opts?.secure ?? shouldUseSecureCookie(),
    path: '/',
    maxAge: Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000),
  };
}

/** Cookie attributes that clear the session cookie (Max-Age=0). */
export function clearedCookieOptions(opts?: { secure?: boolean }): SessionCookieOptions {
  return { ...sessionCookieOptions(opts), maxAge: 0 };
}
