import { NextResponse } from 'next/server';
import { requireAdminMember, NotAdminError, NotAuthenticatedError } from '@/auth/require-admin';
import type { AuthedMember } from '@/auth/auth-provider';

/**
 * Resolve the admin actor for an admin-gated API route, or the matching JSON
 * error response (`403`/`401`). Keeps the verb-handlers in `app/api/members/**`
 * free of repeated gate boilerplate. `require-admin.ts` is the authoritative
 * Node-runtime gate (the Edge middleware only checks cookie presence).
 */
export async function resolveAdminActor(): Promise<
  { ok: true; actor: AuthedMember } | { ok: false; response: NextResponse }
> {
  try {
    const actor = await requireAdminMember();
    return { ok: true, actor };
  } catch (e) {
    if (e instanceof NotAdminError) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Admin privileges required.' }, { status: 403 }),
      };
    }
    if (e instanceof NotAuthenticatedError) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      };
    }
    throw e;
  }
}

/**
 * Resolve an admin actor AND their team for a team-scoped admin resource (repos /
 * workspace). The org admin passes the admin gate but owns no team, so team-scoped
 * cores like `cloneAndRegister` would otherwise throw "Team required" as a 500.
 * Surface that as a clean 400 instead, and thread the resolved `teamId` to callers
 * so the core never runs team-less.
 */
export async function resolveAdminTeam(): Promise<
  { ok: true; actor: AuthedMember; teamId: string } | { ok: false; response: NextResponse }
> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate;
  if (!gate.actor.teamId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Select a team before managing repositories.' },
        { status: 400 },
      ),
    };
  }
  return { ok: true, actor: gate.actor, teamId: gate.actor.teamId };
}
