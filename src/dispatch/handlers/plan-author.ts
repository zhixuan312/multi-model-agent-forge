import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { readPlanFileAsync } from '@/projects/project-files';
import { parsePlanSections } from '@/plan/plan-file-ops';
import { logAction } from '@/observability/action-log';
import { projectEventBus } from '@/sse/event-bus';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { updateDetails } from '@/details/write';
import { validateDetails } from '@/details/schema';
import { getRepos } from '@/details/read';

async function handlePlanAuthor(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  const planFile = await readPlanFileAsync(ctx.projectId);
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
    return d;
  });

  await logAction(
    { projectId: ctx.projectId, memberId: actorId, action: 'author_plan', target: `plan:v${planFile.version}` },
    db,
  );

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
