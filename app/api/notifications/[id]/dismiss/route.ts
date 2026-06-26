import { NextResponse } from 'next/server';
import { dismiss } from '@/collab/notification-store';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  await dismiss(id);
  return NextResponse.json({ ok: true });
}
