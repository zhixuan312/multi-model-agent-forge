import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionStore } from '@/auth/session-store';
import { clearedCookieOptions, SESSION_COOKIE_NAME } from '@/auth/cookie';
import { logEvent } from '@/observability/log-event';

/**
 * Logout (Spec 1, F9): revoke the session row AND clear the session cookie. A
 * follow-up request with the old cookie is then unauthenticated.
 */
export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    const sess = await sessionStore.get(token);
    if (sess) {
      await sessionStore.revoke(sess.id);
      logEvent({ level: 'info', event: 'session.logout', actorId: sess.memberId });
    }
  }

  const res = NextResponse.json({ ok: true });
  // clear the cookie (Max-Age=0)
  res.cookies.set(SESSION_COOKIE_NAME, '', clearedCookieOptions());
  return res;
}
