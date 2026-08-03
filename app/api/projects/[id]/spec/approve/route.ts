import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { updateDetails } from '@/details/write';
import { guardProjectWrite } from '@/auth/guard-project-write';
import { projectEventBus } from '@/sse/event-bus';
import { recordActivity } from '@/activity/project-activity';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  // CSRF + auth + tenant scope — without it, any authed member could approve/revoke another
  // team's spec finalize gate.
  const guard = await guardProjectWrite(req, id);
  if (guard instanceof NextResponse) return guard;
  const me = guard.member;

  // Validate rather than cast. This read `body.action === 'revoke'` off an
  // `as { action?: string }` and treated EVERYTHING else as approve — so `{}`, a typo
  // (`"revokee"`), or a non-string all recorded an approval on the spec finalize gate.
  // A gate must not approve because a caller misspelled the word for the opposite.
  const raw = (await req.json().catch(() => ({}))) as { action?: unknown };
  const action = raw.action === undefined ? 'approve' : raw.action;
  if (action !== 'approve' && action !== 'revoke') {
    return NextResponse.json({ error: 'Expected { action: "approve" | "revoke" }.' }, { status: 400 });
  }
  const db = getDb();

  if (action === 'revoke') {
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
