import { NextResponse, type NextRequest } from 'next/server';
import { evaluateRequest, SESSION_COOKIE_NAME } from '@/auth/middleware-core';

/**
 * Edge-runtime middleware (Spec 1 F28): a STATELESS cookie-presence pre-check
 * only. No DB round-trip, no `is_admin` read (both are Node-runtime facts).
 * Redirects `(app)` routes to `/login` and returns 401 for `/api/*` when the
 * session cookie is absent. Full DB-backed validation runs in
 * `current-member.ts`; admin enforcement in `require-admin.ts`.
 */
export function middleware(req: NextRequest): NextResponse {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const decision = evaluateRequest({
    pathname: req.nextUrl.pathname,
    hasSessionCookie: !!cookie && cookie.trim() !== '',
  });

  switch (decision.action) {
    case 'next': {
      const reqHeaders = new Headers(req.headers);
      reqHeaders.set('x-pathname', req.nextUrl.pathname);
      return NextResponse.next({ request: { headers: reqHeaders } });
    }
    case 'unauthorized':
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    case 'redirect': {
      const url = req.nextUrl.clone();
      url.pathname = decision.to;
      url.search = '';
      return NextResponse.redirect(url);
    }
  }
}

/**
 * Run on all routes EXCEPT Next internals + static assets. The matcher excludes
 * `_next/*` and common asset extensions; the pure core handles the finer
 * public/login allowances.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
