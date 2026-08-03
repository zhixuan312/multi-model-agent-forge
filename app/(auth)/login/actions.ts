'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { attemptLogin } from '@/auth/login-core';
import { resolveClientIp } from '@/auth/client-ip';
import {
  sessionCookieOptions,
  secureCookieWillBeDropped,
  INSECURE_COOKIE_HINT,
} from '@/auth/cookie';
import { SESSION_COOKIE_NAME } from '@/auth/config';
import { logEvent } from '@/observability/log-event';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export interface LoginActionState {
  error?: string;
  retryAfterSeconds?: number;
}

/**
 * Login server action (Spec 1 §Login): rate-limit → authenticate → create
 * session → set the httpOnly cookie → redirect to `/`. The only flow reachable
 * unauthenticated. Returns a generic error on failure (no user-enumeration).
 */
export async function loginAction(
  _prev: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    username: formData.get('username'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: 'Enter a username and password.' };
  }

  const hdrs = await headers();
  const ip = resolveClientIp({
    forwardedFor: hdrs.get('x-forwarded-for'),
    realIp: hdrs.get('x-real-ip'),
  });

  const result = await attemptLogin({ username: parsed.data.username, password: parsed.data.password, ip });

  if (result.kind === 'throttled') {
    return {
      error: 'Too many attempts. Try again later.',
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }
  if (result.kind === 'invalid') {
    return { error: 'Invalid credentials.' };
  }

  // Success → set the session cookie, then redirect.
  const jar = await cookies();
  const opts = sessionCookieOptions();

  // A Secure cookie served over plain HTTP is dropped by the browser: login
  // succeeds server-side but the session never sticks and the user silently
  // loops back to /login. Say so in the log rather than leaving the operator to
  // infer it from `login.success` events that go nowhere.
  if (
    secureCookieWillBeDropped({
      secure: opts.secure,
      forwardedProto: hdrs.get('x-forwarded-proto'),
      origin: hdrs.get('origin'),
      referer: hdrs.get('referer'),
    })
  ) {
    logEvent({
      level: 'warn',
      event: 'login.insecure_cookie',
      actorId: result.memberId,
      ip,
      detail: INSECURE_COOKIE_HINT,
    });
  }

  jar.set(SESSION_COOKIE_NAME, result.token, opts);
  redirect('/');
}
