import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { resetMemberPassword } from '@/auth/members-core';
import type { AuthedMember } from '@/auth/auth-provider';
import { logEvent } from '@/observability/log-event';

type Ctx = { params: Promise<{ id: string }> };

/** Org_admin = every team (unscoped); team_admin = own team only (sentinel = matches nobody). */
function memberScope(actor: AuthedMember): { teamId?: string } {
  return actor.role === 'org_admin' ? {} : { teamId: actor.teamId ?? '__no_team__' };
}

/**
 * Admin Members API — reset a target member's password (Spec 1 §Members CRUD API).
 * `POST { newPassword }`
 *   → 204 (new hash set + password_changed_at bumped (DB clock) → target's
 *          sessions drop; no secret returned)
 *   → 400 weak/empty password / 404 unknown member / 403|401 gate
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;

  const json = await req.json().catch(() => null);
  const result = await resetMemberPassword(id, json, memberScope(gate.actor));

  switch (result.kind) {
    case 'invalid':
      return NextResponse.json({ error: 'New password is too short.' }, { status: 400 });
    case 'not_found':
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    case 'reset':
      logEvent({ event: 'member.reset_password', actorId: gate.actor.id, targetId: id });
      return new NextResponse(null, { status: 204 });
  }
}
