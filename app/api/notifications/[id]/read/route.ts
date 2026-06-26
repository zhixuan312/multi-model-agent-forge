import { NextResponse } from 'next/server';
import { markRead } from '@/collab/notification-store';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  await markRead(id);
  return NextResponse.json({ ok: true });
}
