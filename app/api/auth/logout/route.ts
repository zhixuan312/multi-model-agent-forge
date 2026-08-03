import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { sessionStore } from '@/auth/session-store';
import { clearedCookieOptions } from '@/auth/cookie';
import { SESSION_COOKIE_NAME } from '@/auth/config';
import { logEvent } from '@/observability/log-event';

/**
 * Logout (Spec 1, F9): revoke the session row AND clear the session cookie. A
 * follow-up request with the old cookie is then unauthenticated.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
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
