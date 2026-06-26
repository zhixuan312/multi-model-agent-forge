import { NextResponse } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { listNotifications } from '@/collab/notification-store';

export async function GET(): Promise<NextResponse> {
  const member = await currentMember();
  if (!member) return NextResponse.json({ items: [] });
  const items = await listNotifications(member.id);
  return NextResponse.json({ items });
}
