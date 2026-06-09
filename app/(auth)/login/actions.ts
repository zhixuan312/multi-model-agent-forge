'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { attemptLogin } from '@/auth/login-core';
import { resolveClientIp } from '@/auth/client-ip';
import { sessionCookieOptions, SESSION_COOKIE_NAME } from '@/auth/cookie';

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
    socketAddr: hdrs.get('x-real-ip'),
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
  jar.set(SESSION_COOKIE_NAME, result.token, sessionCookieOptions());
  redirect('/');
}
