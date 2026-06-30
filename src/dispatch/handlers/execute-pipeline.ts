import { eq, and, sql } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import type { Db } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { project, buildPr } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { connectionSettings } from '@/db/schema/identity';
import { createBuildPr } from '@/build/pr';
import { logAction } from '@/observability/action-log';
import { projectEventBus } from '@/sse/event-bus';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

async function handleExecutePipeline(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const request = ctx.request as {
    forgeBranch: string;
    targetBranch: string;
    repoId: string;
    tasks: string[];
    actorId?: string;
  };
  const { forgeBranch, targetBranch, repoId } = request;
  const actorId = request.actorId ?? ctx.actorId ?? 'system';

  const [repoRow] = await db
    .select({ name: repo.name, pathOnDisk: repo.pathOnDisk })
    .from(repo)
    .where(eq(repo.id, repoId))
    .limit(1);
  if (!repoRow) throw new Error(`Repo ${repoId} not found`);

  // Mark tasks as committed
  await db.update(planTask)
    .set({ status: 'committed', updatedAt: new Date() })
    .where(and(eq(planTask.projectId, ctx.projectId), eq(planTask.targetRepoId, repoId)));

  // Push forge branch to origin
  try {
    execFileSync('git', ['-C', repoRow.pathOnDisk, 'push', 'origin', forgeBranch, '--force'], { timeout: 60_000 });
  } catch (pushErr) {
    console.error(`[forge] git push failed for ${repoRow.name}:`, pushErr);
  }

  // Create PR: forgeBranch → targetBranch
  try {
    const [proj] = await db.select({ name: project.name }).from(project).where(eq(project.id, ctx.projectId)).limit(1);
    const tasks = await db.select({ title: planTask.title, commitSha: planTask.commitSha })
      .from(planTask)
      .where(and(eq(planTask.projectId, ctx.projectId), eq(planTask.targetRepoId, repoId)));

    const pr = await createBuildPr(
      {
        readGitToken: async () => {
          const [row] = await db.select({ ref: connectionSettings.gitTokenRef }).from(connectionSettings).limit(1);
          if (!row?.ref) return null;
          const { PostgresSecretStore } = await import('@/secrets/secret-store');
          const secrets = await PostgresSecretStore.create({ db });
          return secrets.get(row.ref);
        },
        parseRemote: (path) => {
          try {
            const url = execFileSync('git', ['-C', path, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
            const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
            return m ? { owner: m[1], repo: m[2] } : null;
          } catch { return null; }
        },
        branchHasChanges: async () => true,
        fetch: globalThis.fetch,
      },
      {
        projectName: proj?.name ?? ctx.projectId,
        branch: forgeBranch,
        targetBranch,
        repoPath: repoRow.pathOnDisk,
        tasks: tasks.map((t) => ({ title: t.title, commitSha: t.commitSha })),
      },
    );
    if (pr && 'url' in pr) {
      await db
        .insert(buildPr)
        .values({ projectId: ctx.projectId, repoId, url: pr.url, branch: forgeBranch, targetBranch })
        .onConflictDoUpdate({
          target: [buildPr.projectId, buildPr.repoId],
          set: { url: pr.url, branch: forgeBranch, targetBranch },
        });
      await logAction({ projectId: ctx.projectId, memberId: actorId, action: 'create_pr', target: `repo:${repoRow.name}` }, db);
    }
  } catch (prErr) {
    console.error(`[forge] PR creation failed for ${repoRow.name}:`, prErr);
  }
}

registerHandler('execute-pipeline', handleExecutePipeline);
