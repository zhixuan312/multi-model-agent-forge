import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { stage } from '@/db/schema/projects';
import { participant } from '@/db/schema/participants';
import { currentMember } from '@/auth/current-member';
import { projectEventBus } from '@/sse/event-bus';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const db = getDb();

  const [row] = await db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.projectId, id), eq(stage.kind, 'spec')))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'Stage not found' }, { status: 404 });

  if (body.action === 'revoke') {
    await db.delete(participant).where(
      and(
        eq(participant.scopeId, row.id),
        eq(participant.memberId, me.id),
        eq(participant.scope, 'stage'),
        eq(participant.role, 'approver'),
      ),
    );
  } else {
    await db
      .insert(participant)
      .values({ projectId: id, memberId: me.id, scope: 'stage', scopeId: row.id, role: 'approver' })
      .onConflictDoNothing();
  }

  projectEventBus.publish(id, { type: 'spec.updated' });
  return NextResponse.json({ ok: true });
}
