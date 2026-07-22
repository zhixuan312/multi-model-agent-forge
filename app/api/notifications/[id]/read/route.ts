import { NextResponse } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { markRead } from '@/collab/notification-store';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const member = await currentMember();
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await markRead(id, member.id);
  return NextResponse.json({ ok: true });
}
