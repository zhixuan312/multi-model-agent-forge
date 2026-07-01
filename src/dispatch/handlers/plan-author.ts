import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { project } from '@/db/schema/projects';
import { projectRepo } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { readPlanFileAsync } from '@/projects/project-files';
import { parsePlanSections } from '@/plan/plan-file-ops';
import { logAction } from '@/observability/action-log';
import { projectEventBus } from '@/sse/event-bus';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';


async function handlePlanAuthor(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  const existing = await db
    .select({ id: planTask.id })
    .from(planTask)
    .where(eq(planTask.projectId, ctx.projectId))
    .limit(1);
  if (existing.length > 0) return;

  // MMA writes plan.md directly to .mma/projects/<id>/plan.md
  const planFile = await readPlanFileAsync(ctx.projectId);
  if (!planFile) {
    throw new Error('MMA did not write plan.md. The plan-author task may have failed.');
  }

  const sections = parsePlanSections(planFile.bodyMd);
  if (sections.length === 0) {
    throw new Error('Plan file has no ### task sections.');
  }

  const repos = await db
    .select({ id: repo.id, name: repo.name })
    .from(projectRepo)
    .innerJoin(repo, eq(projectRepo.repoId, repo.id))
    .where(eq(projectRepo.projectId, ctx.projectId));
  if (repos.length === 0) throw new Error('No repos linked to this project.');
  const defaultRepoId = repos[0].id;

  // Persist plan_task rows
  const actorId = (ctx.request as { actorId?: string })?.actorId ?? ctx.actorId ?? 'system';
  const tasks = await db.transaction(async (tx) => {
    const inserted: Array<{ id: string; title: string }> = [];
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      const title = s.heading.replace(/^###\s*/, '').trim();
      const [row] = await tx
        .insert(planTask)
        .values({
          projectId: ctx.projectId,
          title,
          phase: s.phase ?? null,
          targetRepoId: defaultRepoId,
          orderIndex: i,
        })
        .returning({ id: planTask.id });
      inserted.push({ id: row.id, title });
    }

    await logAction(
      { projectId: ctx.projectId, memberId: actorId, action: 'author_plan', target: `plan:v${planFile.version}` },
      tx as unknown as Db,
    );
    return inserted;
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
