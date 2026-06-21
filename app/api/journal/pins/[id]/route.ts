import { NextResponse, type NextRequest } from 'next/server';
import { guardJournal } from '@/journal/guard';
import { removePin } from '@/journal/pins-core';

/**
 * `DELETE /api/journal/pins/[id]` — unpin (owner-scoped, same-origin).
 * 204 on the caller's own pin · 404 for a missing or non-owner id.
 */
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const guard = await guardJournal(req, { checkCsrf: true });
  if (guard instanceof NextResponse) return guard;
  const { id } = await ctx.params;
  const result = await removePin(guard.memberId, id);
  if (result.kind === 'not_found') return NextResponse.json({ error: 'Pin not found.' }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
