import { eq } from 'drizzle-orm';
import { sectionTitle } from '@/lib/markdown-outline';
import { randomUUID } from 'node:crypto';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { readPlanFile } from '@/projects/project-files';
import { parsePlanSections } from '@/plan/plan-file-ops';
import { projectEventBus } from '@/sse/event-bus';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { updateDetails } from '@/details/write';
import { validateDetails } from '@/details/schema';
import { getRepos } from '@/details/read';

async function handlePlanAuthor(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  const planFile = await readPlanFile(ctx.projectId);
  if (!planFile) {
    throw new Error('MMA did not write plan.md. The plan-author task may have failed.');
  }

  const sections = parsePlanSections(planFile.bodyMd);
  if (sections.length === 0) {
    throw new Error('Plan file has no ### task sections.');
  }

  const [proj] = await db.select({ details: project.details }).from(project).where(eq(project.id, ctx.projectId)).limit(1);
  const details = proj?.details ? validateDetails(proj.details) : null;
  const repos = details ? getRepos(details) : [];
  if (repos.length === 0) throw new Error('No repos linked to this project.');

  const tasks: Array<{ id: string; title: string }> = [];

  await updateDetails(db, ctx.projectId, (d) => {
    d.stages.plan.phases.refine.tasks = sections.map((s) => {
      const id = randomUUID();
      const title = sectionTitle(s.heading);
      tasks.push({ id, title });
      return { id, title, status: 'pending' as const, approvals: [], attempts: [], reviewPolicy: 'reviewed' as const };
    });
    d.stages.plan.phases.refine.file = 'plan.md';
    // Close out the running author attempt recorded at dispatch time so the
    // automation resolver stops WAITing and advances to task validation.
    const atts = d.stages.plan.phases.refine.attempts;
    const last = atts[atts.length - 1];
    if (last && last.status === 'running') last.status = 'done';
    return d;
  });

  // `plan.stage_updated` — the SAME signal `plan-audit` and `plan-audit-apply` publish, and
  // the one `PlanStageClient` subscribes to. This published `plan.authored` instead, with a
  // rich payload (tasks, writeTargets, readOnly, a hardcoded reviewPolicy) that no component
  // has ever subscribed to. Auto-driven work never reaches the client's `onDone`, so a plan
  // authored by the driver left the rail stale until something else refreshed it — the exact
  // failure the `plan.stage_updated` comment in `PlanStageClient` describes for its siblings.
  projectEventBus.publish(ctx.projectId, { type: 'plan.stage_updated' });
}

registerHandler('plan-author', handlePlanAuthor);
