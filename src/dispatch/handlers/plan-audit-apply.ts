import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

interface RevisedTask {
  title: string;
  detail: string;
}

interface NewTask {
  title: string;
  detail: string;
  dependsOn: string[];
  reviewPolicy: string;
}

async function handlePlanAuditApply(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const parsed = JSON.parse(raw) as { revisedTasks?: RevisedTask[]; newTasks?: NewTask[] };

  // Update existing tasks by matching title
  if (parsed.revisedTasks && parsed.revisedTasks.length > 0) {
    const allTasks = await db
      .select({ id: planTask.id, title: planTask.title })
      .from(planTask)
      .where(eq(planTask.projectId, ctx.projectId));
    const idByTitle = new Map(allTasks.map((t) => [t.title, t.id]));

    for (const rt of parsed.revisedTasks) {
      const taskId = idByTitle.get(rt.title);
      if (taskId) {
        await db.update(planTask).set({ detail: rt.detail, updatedAt: new Date() }).where(eq(planTask.id, taskId));
      }
    }
  }

  // Insert new tasks if any
  if (parsed.newTasks && parsed.newTasks.length > 0) {
    const maxOrder = await db
      .select({ id: planTask.id })
      .from(planTask)
      .where(eq(planTask.projectId, ctx.projectId));

    for (let i = 0; i < parsed.newTasks.length; i++) {
      const nt = parsed.newTasks[i];
      await db.insert(planTask).values({
        projectId: ctx.projectId,
        title: nt.title,
        detail: nt.detail,
        targetRepoId: (await db.select({ id: planTask.targetRepoId }).from(planTask).where(eq(planTask.projectId, ctx.projectId)).limit(1))[0]?.id ?? '',
        orderIndex: maxOrder.length + i,
        reviewPolicy: (nt.reviewPolicy === 'none' ? 'none' : 'reviewed') as 'reviewed' | 'none',
        status: 'queued',
      });
    }
  }
}

registerHandler('plan-audit-apply', handlePlanAuditApply);
