import { eq } from 'drizzle-orm';
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

  const actorId = (ctx.request as { actorId?: string })?.actorId ?? ctx.actorId ?? 'system';
  const tasks: Array<{ id: string; title: string }> = [];

  await updateDetails(db, ctx.projectId, (d) => {
    d.stages.plan.phases.refine.tasks = sections.map((s) => {
      const id = randomUUID();
      const title = s.heading.replace(/^###\s*/, '').trim();
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

  projectEventBus.publish(ctx.projectId, {
    type: 'plan.authored',
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      repo: repos[0].name,
      reviewPolicy: 'reviewed',
    })),
    writeTargets: repos.map((r) => r.name),
    readOnly: [],
  });
}

registerHandler('plan-author', handlePlanAuthor);
