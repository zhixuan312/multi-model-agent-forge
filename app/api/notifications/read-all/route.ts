import { NextResponse } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { markAllRead } from '@/collab/notification-store';

export async function POST(): Promise<NextResponse> {
  const member = await currentMember();
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await markAllRead(member.id);
  return NextResponse.json({ ok: true });
}
