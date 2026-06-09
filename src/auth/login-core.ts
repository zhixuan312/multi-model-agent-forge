import { localAuthProvider, type AuthProvider } from '@/auth/auth-provider';
import { LoginRateLimiter, loginRateLimiter } from '@/auth/rate-limit';
import { sessionStore, type SessionStore } from '@/auth/session-store';
import { logEvent } from '@/observability/log-event';

/**
 * The login flow core (Spec 1 §Login), dependency-injected so it's testable
 * against the live DB without the Next.js request plumbing:
 *
 *   1. Rate-limit pre-check (two independent counters) — short-circuit with a
 *      generic throttle (argon2id SKIPPED) when either trips.
 *   2. authenticate(local) — full argon2id verify on both paths (timing-equality).
 *   3. On success: create a session, reset both rate counters, return the token.
 *   4. On failure: increment both counters, generic error (no enumeration).
 */

export type LoginResult =
  | { kind: 'throttled'; retryAfterSeconds: number }
  | { kind: 'invalid' }
  | { kind: 'success'; token: string; memberId: string };

export interface LoginDeps {
  provider?: AuthProvider;
  store?: SessionStore;
  rateLimiter?: LoginRateLimiter;
}

export async function attemptLogin(
  input: { username: string; password: string; ip: string },
  deps: LoginDeps = {},
): Promise<LoginResult> {
  const provider = deps.provider ?? localAuthProvider;
  const store = deps.store ?? sessionStore;
  const rl = deps.rateLimiter ?? loginRateLimiter;

  const keys = { username: input.username, ip: input.ip };

  // 1. Rate-limit pre-check — do NOT run argon2id when throttled.
  const verdict = rl.check(keys);
  if (verdict.throttled) {
    logEvent({ level: 'warn', event: 'login.throttled', rateLimitKey: verdict.key, ip: input.ip });
    return { kind: 'throttled', retryAfterSeconds: verdict.retryAfterSeconds };
  }

  // 2. Authenticate (full argon2id verify on both unknown-user + wrong-pass).
  const member = await provider.authenticate(input.username, input.password);

  if (!member) {
    // 4. Failure → bump both counters, generic error.
    rl.recordFailure(keys);
    logEvent({ level: 'warn', event: 'login.failure', rateLimitKey: `u:${input.username.toLowerCase()}`, ip: input.ip });
    return { kind: 'invalid' };
  }

  // 3. Success → create session, reset both counters.
  const created = await store.create(member.id);
  rl.recordSuccess(keys);
  logEvent({ level: 'info', event: 'login.success', actorId: member.id, ip: input.ip });
  return { kind: 'success', token: created.token, memberId: member.id };
}
