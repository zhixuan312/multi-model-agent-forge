import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { updateOwnProfile } from '@/auth/profile-core';

/**
 * Own-profile update (Spec 1 §Profile). Any authenticated member may edit their
 * own display name + avatar tint. `PATCH { displayName, avatarTint }`
 *   → 200 { displayName, avatarTint } / 400 invalid / 401 unauthenticated.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const result = await updateOwnProfile(me.id, json);

  switch (result.kind) {
    case 'invalid':
      return NextResponse.json(
        { error: 'A display name and a valid hex avatar tint are required.' },
        { status: 400 },
      );
    case 'not_found':
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    case 'updated':
      return NextResponse.json({
        displayName: result.displayName,
        avatarTint: result.avatarTint,
      });
  }
}
