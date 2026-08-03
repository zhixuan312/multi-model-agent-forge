import { NextResponse } from 'next/server';

/**
 * The three refusals every API route shares.
 *
 * `{ error: 'Unauthorized' }, { status: 401 }` was written out THIRTY-SEVEN times, and
 * the two role refusals eight more. They are not just repetition: the API has two error
 * envelopes (see `responseError` in `@/lib/err`), so the shape of a refusal is a
 * decision, and thirty-seven copies is thirty-seven places to make it differently.
 */

/** No session at all. */
export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/** A session, but not the right role. */
export function forbidden(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

/** A write to a project the caller may not touch. 403 (not 404) is deliberate: a WRITE
 *  caller already knows the project exists, so there is nothing left to hide. */
export const NOT_A_PROJECT_MEMBER = 'Forbidden';

/** A state-changing request that did not come from this origin (the CSRF control). */
export const CROSS_ORIGIN_REJECTED = 'Cross-origin request rejected.';

/** The org admin owns shared infra: connections, providers, teams. */
export const ORG_ADMIN_REQUIRED = 'Org admin privileges required.';
/** The team admin owns their own team's config: git token, workspace, roster. */
export const TEAM_ADMIN_REQUIRED = 'Team admin privileges required.';

/**
 * Anti-enumeration refusal for a READ: an unreadable resource must be indistinguishable
 * from a missing one, so a caller probing ids learns nothing.
 */
export function notFound(): NextResponse {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
