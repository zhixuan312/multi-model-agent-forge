import { SESSION_COOKIE_NAME } from '@/auth/config';

/**
 * Stateless cookie-presence pre-check logic for the Edge middleware (F28). NO
 * DB, NO is_admin — middleware can't open a Postgres connection on the Edge
 * runtime and can't read a DB fact. Full validation lives in `current-member.ts`
 * (Node runtime); admin enforcement in `require-admin.ts`.
 *
 * This pure core is unit-testable without a NextRequest. It decides, from the
 * pathname and whether a non-empty session cookie is present, what the
 * middleware should do.
 */

export type MiddlewareDecision =
  | { action: 'next' }
  | { action: 'redirect'; to: string }
  | { action: 'unauthorized' }; // 401 JSON for /api

/** Routes always reachable without a session cookie. */
function isPublicPath(pathname: string): boolean {
  // The login + first-run setup pages and their server-action POST targets,
  // plus Next internals/assets. `/setup` is reachable while logged out so the
  // first admin can be registered before any session exists; the page itself
  // closes the gate (redirects to /login) once a member exists.
  if (pathname === '/login' || pathname.startsWith('/login/')) return true;
  if (pathname === '/setup' || pathname.startsWith('/setup/')) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname === '/favicon.ico') return true;
  return false;
}

/** The only `/api` route reachable unauthenticated (so the login action can run
 *  before a session exists). Login is a server action on the page, but if an
 *  API login endpoint is added it lives here. */
function isPublicApi(pathname: string): boolean {
  return pathname === '/api/auth/login';
}

export function evaluateRequest(opts: {
  pathname: string;
  hasSessionCookie: boolean;
}): MiddlewareDecision {
  const { pathname, hasSessionCookie } = opts;

  if (isPublicPath(pathname)) return { action: 'next' };

  const isApi = pathname.startsWith('/api/');
  if (isApi && isPublicApi(pathname)) return { action: 'next' };

  if (hasSessionCookie) return { action: 'next' };

  // No session cookie present.
  if (isApi) return { action: 'unauthorized' };
  return { action: 'redirect', to: '/login' };
}

export { SESSION_COOKIE_NAME };
