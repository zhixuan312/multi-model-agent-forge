import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { currentMember } from '@/auth/current-member';
import { projectEventBus } from '@/sse/event-bus';
import { updateDetails, appendProjectEvent } from '@/details/write';
import { validateDetails } from '@/details/schema';

type Ctx = { params: Promise<{ id: string; taskId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, taskId } = await ctx.params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();

  let taskTitle = '';
  await updateDetails(db, id, (d) => {
    const task = d.stages.plan.phases.refine.tasks.find((t) => t.id === taskId);
    if (task) {
      if (!task.approvals.includes(me.id)) task.approvals.push(me.id);
      task.status = 'approved';
      taskTitle = task.title;
    }
    return d;
  });
  await appendProjectEvent(db, id, { stage: 'plan', phase: 'refine', detail: `${me.displayName} approved task: ${taskTitle}`, kind: 'done' });

  projectEventBus.publish(id, { type: 'plan.updated', taskId, chatReply: `${me.displayName} approved this task.`, updated: true });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, taskId } = await ctx.params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();

  await updateDetails(db, id, (d) => {
    const task = d.stages.plan.phases.refine.tasks.find((t) => t.id === taskId);
    if (task) {
      task.approvals = task.approvals.filter((a) => a !== me.id);
      task.status = task.approvals.length > 0 ? 'approved' : 'pending';
    }
    return d;
  });

  projectEventBus.publish(id, { type: 'plan.updated', taskId, chatReply: `${me.displayName} revoked approval.`, updated: true });
  return NextResponse.json({ ok: true });
}
