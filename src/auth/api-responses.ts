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

/** The org admin owns shared infra: connections, providers, teams. */
export const ORG_ADMIN_REQUIRED = 'Org admin privileges required.';
/** The team admin owns their own team's config: git token, workspace, roster. */
export const TEAM_ADMIN_REQUIRED = 'Team admin privileges required.';
