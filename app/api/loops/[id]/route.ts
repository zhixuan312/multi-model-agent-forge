import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { getLoop, updateLoop, deleteLoop } from '@/loops/loops-core';

/**
 * Admin per-loop API (spec §6). `GET` reads, `PATCH` updates (incl. enable/pause
 * via `{ enabled }`), `DELETE` removes (cascades runs). Admin-gated.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const loop = await getLoop(id);
  return loop ? NextResponse.json(loop) : NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const result = await updateLoop(id, json);
  switch (result.kind) {
    case 'updated':
      return NextResponse.json(result.loop);
    case 'not_found':
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    case 'duplicate_name':
      return NextResponse.json({ error: 'duplicate_name', message: 'A loop with that name already exists.' }, { status: 409 });
    case 'invalid_config':
      return NextResponse.json({ error: 'invalid_config' }, { status: 400 });
    case 'invalid_cron':
      return NextResponse.json({ error: 'invalid_cron' }, { status: 400 });
    case 'invalid':
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const result = await deleteLoop(id);
  return result.kind === 'deleted'
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: 'not_found' }, { status: 404 });
}
