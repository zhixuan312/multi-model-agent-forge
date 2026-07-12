import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { listLoops, createLoop, toPublicLoop } from '@/loops/loops-core';

/**
 * Admin Loops API (spec §6). `GET` lists loops; `POST` creates one. Admin-gated.
 * Per-kind config + cron are validated in the core; the route maps result kinds
 * to HTTP status.
 */
export async function GET(): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  return NextResponse.json({ loops: (await listLoops()).map(toPublicLoop) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;

  const json = await req.json().catch(() => null);
  const result = await createLoop(json, { actorId: gate.actor.id, teamId: gate.actor.teamId ?? undefined });
  switch (result.kind) {
    case 'created':
      return NextResponse.json({ loop: toPublicLoop(result.loop), eventToken: result.eventToken }, { status: 201 });
    case 'duplicate_name':
      return NextResponse.json({ error: 'duplicate_name', message: 'A loop with that name already exists.' }, { status: 409 });
    case 'invalid_config':
      return NextResponse.json({ error: 'invalid_config', message: 'The goal/config is invalid for this kind.' }, { status: 400 });
    case 'invalid_cron':
      return NextResponse.json({ error: 'invalid_cron', message: 'The cron expression is invalid.' }, { status: 400 });
    case 'invalid_mode':
      return NextResponse.json({ error: 'invalid_mode', message: 'The selected mode and cron combination is invalid.' }, { status: 400 });
    case 'invalid':
      return NextResponse.json({ error: 'invalid_request', message: 'Bad/missing fields.' }, { status: 400 });
  }
}
