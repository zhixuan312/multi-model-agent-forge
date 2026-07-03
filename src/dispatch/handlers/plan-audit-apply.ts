import type { Db } from '@/db/client';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { readPlanFileAsync } from '@/projects/project-files';
import { parsePlanSections } from '@/plan/plan-file-ops';
import { updateDetails } from '@/details/write';

async function handlePlanAuditApply(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  const planFile = await readPlanFileAsync(ctx.projectId);
  if (!planFile) {
    throw new Error('plan.md not found after audit-apply — MMA may have failed to write it.');
  }

  const sections = parsePlanSections(planFile.bodyMd);

  await updateDetails(db, ctx.projectId, (d) => {
    const tasks = d.stages.plan.phases.refine.tasks;
    for (let i = 0; i < tasks.length; i++) {
      const section = sections[i];
      if (!section) continue;
      const fileTitle = section.heading.replace(/^###\s*/, '').trim();
      if (fileTitle !== tasks[i].title) {
        tasks[i].title = fileTitle;
      }
    }
    return d;
  });
}

registerHandler('plan-audit-apply', handlePlanAuditApply);
