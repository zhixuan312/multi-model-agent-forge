import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { requireTeamScope, assertTeamAdmin } from '@/auth/team-scope';
import { createMember } from '@/auth/members-core';
import { logEvent } from '@/observability/log-event';

/**
 * Team Members API — create a member in the current team (Spec 1 §Members CRUD API).
 * `POST { displayName, username, password }`
 *   → 201 { id, username, displayName, avatarTint, isAdmin:false }
 *   → 409 duplicate username (case-insensitive)
 *   → 400 weak/empty password or missing field
 *   → 403 non-team-admin / 401 unauthenticated
 *
 * Team-admin-gated. The password is never echoed.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await currentMember();
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let scope;
  try {
    scope = await requireTeamScope();
    assertTeamAdmin(scope.actor, scope.currentTeam.id);
  } catch {
    return NextResponse.json({ error: 'Team admin privileges required.' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const result = await createMember(json, scope.currentTeam.id);

  switch (result.kind) {
    case 'invalid':
      return NextResponse.json(
        { error: 'Display name, username, and a password of at least the minimum length are required.' },
        { status: 400 },
      );
    case 'duplicate_username':
      return NextResponse.json(
        { error: 'That username is already taken.', field: 'username' },
        { status: 409 },
      );
    case 'created':
      logEvent({ event: 'member.create', actorId: scope.actor.id, targetId: result.member.id });
      return NextResponse.json(result.member, { status: 201 });
  }
}
