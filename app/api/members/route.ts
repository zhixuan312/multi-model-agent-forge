import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { createMember } from '@/auth/members-core';
import { logEvent } from '@/observability/log-event';

/**
 * Admin Members API — create a member (Spec 1 §Members CRUD API).
 * `POST { displayName, username, password }`
 *   → 201 { id, username, displayName, avatarTint, isAdmin:false }
 *   → 409 duplicate username (case-insensitive)
 *   → 400 weak/empty password or missing field
 *   → 403 non-admin / 401 unauthenticated
 *
 * Admin-gated by `require-admin.ts` (the authoritative Node-runtime gate; the
 * Edge middleware only checks cookie presence). The password is never echoed.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;

  const json = await req.json().catch(() => null);
  const result = await createMember(json);

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
      logEvent({ event: 'member.create', actorId: gate.actor.id, targetId: result.member.id });
      return NextResponse.json(result.member, { status: 201 });
  }
}
