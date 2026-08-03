import { NextResponse } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { unauthorized } from '@/auth/api-responses';
import { listNotifications } from '@/collab/notification-store';

export async function GET(): Promise<NextResponse> {
  const member = await currentMember();
  // 401, like every other route — this answered an unauthenticated caller with an empty
  // list and a 200, which the bell cannot tell apart from "you have no notifications".
  // `NotificationBell` already ignores a non-ok response and keeps its last state, so an
  // expired session no longer silently empties the bell.
  if (!member) return unauthorized();
  const items = await listNotifications(member.id);
  return NextResponse.json({ items });
}
