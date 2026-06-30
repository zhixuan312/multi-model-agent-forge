import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { participant } from '@/db/schema/participants';
import { currentMember } from '@/auth/current-member';
import { projectEventBus } from '@/sse/event-bus';

type Ctx = { params: Promise<{ id: string; taskId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, taskId } = await ctx.params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();

  await db
    .insert(participant)
    .values({ projectId: id, memberId: me.id, scope: 'task', scopeId: taskId, role: 'approver' })
    .onConflictDoNothing();
  await db
    .insert(participant)
    .values({ projectId: id, memberId: me.id, scope: 'task', scopeId: taskId, role: 'reviewer' })
    .onConflictDoNothing();

  await db.update(planTask).set({
    status: 'committed',
    updatedAt: new Date(),
  }).where(eq(planTask.id, taskId));

  projectEventBus.publish(id, { type: 'plan.updated', taskId, chatReply: `${me.displayName} approved this task.`, updated: true });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, taskId } = await ctx.params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();

  await db.delete(participant).where(
    and(
      eq(participant.scopeId, taskId),
      eq(participant.memberId, me.id),
      eq(participant.scope, 'task'),
      eq(participant.role, 'approver'),
    ),
  );

  const remaining = await db
    .select({ memberId: participant.memberId })
    .from(participant)
    .where(and(eq(participant.scopeId, taskId), eq(participant.scope, 'task'), eq(participant.role, 'approver')));

  await db.update(planTask).set({
    status: remaining.length > 0 ? 'committed' : 'queued',
    updatedAt: new Date(),
  }).where(eq(planTask.id, taskId));

  projectEventBus.publish(id, { type: 'plan.updated', taskId, chatReply: `${me.displayName} revoked approval.`, updated: true });
  return NextResponse.json({ ok: true });
}
