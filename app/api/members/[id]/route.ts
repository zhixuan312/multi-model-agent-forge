import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { setMemberAdmin, deleteMember, type MembersDeps } from '@/auth/members-core';
import type { AuthedMember } from '@/auth/auth-provider';
import { logEvent } from '@/observability/log-event';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Scope member mutations to the actor's team. An org_admin owns every team (no scope);
 * a team_admin may only touch members of their OWN team — the sentinel guarantees a
 * team_admin with a null teamId matches nobody rather than falling through unscoped.
 */
function memberScope(actor: AuthedMember): Pick<MembersDeps, 'teamId'> {
  return actor.role === 'org_admin' ? {} : { teamId: actor.teamId ?? '__no_team__' };
}

/**
 * Admin Members API — toggle admin (Spec 1 §Members CRUD API).
 * `PATCH { isAdmin: boolean }`
 *   → 200 { id, isAdmin }
 *   → 409 if it would demote the LAST admin (last-admin invariant)
 *   → 404 unknown member / 400 invalid body / 403|401 gate
 */
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;

  const json = await req.json().catch(() => null);
  const result = await setMemberAdmin(id, json, memberScope(gate.actor));

  switch (result.kind) {
    case 'invalid':
      return NextResponse.json({ error: 'Expected { isAdmin: boolean }.' }, { status: 400 });
    case 'not_found':
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    case 'last_admin':
      return NextResponse.json(
        { error: 'Cannot remove the last admin — the team would have no admin.' },
        { status: 409 },
      );
    case 'updated':
      logEvent({ event: 'member.toggle_admin', actorId: gate.actor.id, targetId: id });
      return NextResponse.json({ id: result.id, isAdmin: result.isAdmin });
  }
}

/**
 * Admin Members API — hard-delete a member (Spec 1 §Members CRUD API).
 * `DELETE`
 *   → 204 (ON DELETE CASCADE removes the member's identities + sessions)
 *   → 409 if it would delete the LAST admin (self or other)
 *   → 404 unknown member / 403|401 gate
 */
export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;

  const result = await deleteMember(id, memberScope(gate.actor));

  switch (result.kind) {
    case 'not_found':
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    case 'last_admin':
      return NextResponse.json(
        { error: 'Cannot delete the last admin — the team would have no admin.' },
        { status: 409 },
      );
    case 'deleted':
      logEvent({ event: 'member.delete', actorId: gate.actor.id, targetId: id });
      return new NextResponse(null, { status: 204 });
  }
}
