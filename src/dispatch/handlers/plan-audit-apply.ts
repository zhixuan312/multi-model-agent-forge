import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { readPlanFileAsync } from '@/projects/project-files';
import { parsePlanSections } from '@/plan/plan-file-ops';

async function handlePlanAuditApply(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  const planFile = await readPlanFileAsync(ctx.projectId);
  if (!planFile) {
    throw new Error('plan.md not found after audit-apply — MMA may have failed to write it.');
  }

  // Sync DB plan_task titles with the updated plan.md headings.
  // MMA may have renamed headings despite being told not to.
  const sections = parsePlanSections(planFile.bodyMd);
  const dbTasks = await db
    .select({ id: planTask.id, title: planTask.title, orderIndex: planTask.orderIndex })
    .from(planTask)
    .where(eq(planTask.projectId, ctx.projectId));

  for (const dbTask of dbTasks) {
    const section = sections[dbTask.orderIndex];
    if (!section) continue;
    const fileTitle = section.heading.replace(/^###\s*/, '').trim();
    if (fileTitle !== dbTask.title) {
      await db.update(planTask)
        .set({ title: fileTitle, updatedAt: new Date() })
        .where(eq(planTask.id, dbTask.id));
    }
  }
}

registerHandler('plan-audit-apply', handlePlanAuditApply);
