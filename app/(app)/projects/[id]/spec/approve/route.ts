import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { updateDetails } from '@/details/write';
import { guardSpecWrite } from '@/spec/handler-guard';
import { projectEventBus } from '@/sse/event-bus';
import { recordActivity } from '@/activity/project-activity';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  // CSRF + auth + tenant scope — without it, any authed member could approve/revoke another
  // team's spec finalize gate.
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;
  const me = guard.member;

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const db = getDb();

  if (body.action === 'revoke') {
    await updateDetails(db, id, (d) => {
      d.stages.spec.phases.finalize.approvals = d.stages.spec.phases.finalize.approvals.filter((p) => p !== me.id);
      return d;
    });
  } else {
    await updateDetails(db, id, (d) => {
      if (!d.stages.spec.phases.finalize.approvals.includes(me.id)) d.stages.spec.phases.finalize.approvals.push(me.id);
      return d;
    });
    await recordActivity({
      db,
      projectId: id,
      stage: 'spec',
      phase: 'finalize',
      label: `${me.displayName} approved the spec`,
      kind: 'done',
      actor: { id: me.id, name: me.displayName, tint: me.avatarTint },
      source: 'user',
      eventKey: `approve_spec:${id}:${me.id}`,
    });
  }

  projectEventBus.publish(id, { type: 'spec.updated' });
  return NextResponse.json({ ok: true });
}
