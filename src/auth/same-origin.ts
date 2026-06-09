import { NextResponse, type NextRequest } from 'next/server';

/**
 * Same-origin (CSRF) enforcement for state-changing routes (Spec 2 F12).
 *
 * Every cookie-authenticated mutation route (settings apply/providers/roster/
 * connections, workspace clone/pull) must reject a forged cross-origin request
 * even with a valid admin session — the highest-impact of these restarts the
 * co-located MMA process. We verify `Sec-Fetch-Site` is same-origin (or, when
 * that header is absent, that `Origin` matches `Host`). A GET is never a state
 * change and is not checked here.
 *
 * Returns a 403 `NextResponse` when the request is cross-origin, else null.
 */
export function rejectCrossOrigin(req: NextRequest): NextResponse | null {
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite !== null) {
    // 'same-origin' and 'none' (direct navigation/no referrer) are allowed;
    // 'cross-site' and 'same-site' (different subdomain) are rejected.
    if (secFetchSite === 'same-origin' || secFetchSite === 'none') return null;
    return forbidden();
  }

  // Fallback for clients that don't send Sec-Fetch-Site: compare Origin to Host.
  const origin = req.headers.get('origin');
  if (origin === null) return null; // no Origin (e.g. same-origin non-CORS) → allow
  const host = req.headers.get('host');
  try {
    const originHost = new URL(origin).host;
    if (host && originHost === host) return null;
  } catch {
    /* malformed Origin → reject */
  }
  return forbidden();
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
}
