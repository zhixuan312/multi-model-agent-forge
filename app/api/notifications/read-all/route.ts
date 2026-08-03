import { NextResponse, type NextRequest } from 'next/server';
import { unauthorized } from '@/auth/api-responses';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { currentMember } from '@/auth/current-member';
import { markAllRead } from '@/collab/notification-store';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  const member = await currentMember();
  if (!member) return unauthorized();
  await markAllRead(member.id);
  return NextResponse.json({ ok: true });
}
