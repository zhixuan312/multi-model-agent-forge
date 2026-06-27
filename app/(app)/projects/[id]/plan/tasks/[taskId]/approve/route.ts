import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { currentMember } from '@/auth/current-member';
import { projectEventBus } from '@/sse/event-bus';

type Ctx = { params: Promise<{ id: string; taskId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, taskId } = await ctx.params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const [task] = await db.select({ approvedBy: planTask.approvedBy, participants: planTask.participants }).from(planTask).where(eq(planTask.id, taskId)).limit(1);
  const approvers = (task?.approvedBy as string[] | null) ?? [];
  const parts = (task?.participants as string[] | null) ?? [];

  const updatedApprovers = approvers.includes(me.id) ? approvers : [...approvers, me.id];
  const updatedParts = parts.includes(me.id) ? parts : [...parts, me.id];

  await db.update(planTask).set({
    status: 'committed',
    approvedBy: updatedApprovers as unknown as object,
    participants: updatedParts as unknown as object,
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
  const [task] = await db.select({ approvedBy: planTask.approvedBy }).from(planTask).where(eq(planTask.id, taskId)).limit(1);
  const approvers = (task?.approvedBy as string[] | null) ?? [];
  const updated = approvers.filter((a) => a !== me.id);

  await db.update(planTask).set({
    status: updated.length > 0 ? 'committed' : 'queued',
    approvedBy: updated as unknown as object,
    updatedAt: new Date(),
  }).where(eq(planTask.id, taskId));

  projectEventBus.publish(id, { type: 'plan.updated', taskId, chatReply: `${me.displayName} revoked approval.`, updated: true });
  return NextResponse.json({ ok: true });
}
