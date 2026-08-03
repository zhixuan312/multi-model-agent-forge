import { NextResponse, type NextRequest } from 'next/server';
import { unauthorized } from '@/auth/api-responses';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { currentMember } from '@/auth/current-member';
import { markRead } from '@/collab/notification-store';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const member = await currentMember();
  if (!member) return unauthorized();
  const { id } = await params;
  await markRead(id, member.id);
  return NextResponse.json({ ok: true });
}
