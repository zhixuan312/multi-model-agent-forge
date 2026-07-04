import { eq } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import type { Db } from '@/db/client';
import { project, buildPr } from '@/db/schema/projects';
import { connectionSettings } from '@/db/schema/identity';
import { createBuildPr } from '@/build/pr';
import { logAction } from '@/observability/action-log';
import { projectEventBus } from '@/sse/event-bus';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { validateDetails } from '@/details/schema';
import { updateDetails } from '@/details/write';
import { recordImplementAttempt } from '@/automation/details-mutations';

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
  if (!repoId) return; // can't correlate this terminal to a repo/attempt

  // Record the implement attempt (DONE) + mark tasks committed, so the auto
  // resolver advances to Review. Manual mode ignores the implement attempt — this
  // is the single writer of that gating state for both triggers.
  await updateDetails(db, ctx.projectId, (det) => recordImplementAttempt(det, repoId, ctx.batchRowId, new Date().toISOString()));

  // The branch/PR machinery needs the branch meta the shared core always sets; if
  // it is somehow absent the attempt is already recorded above (pipeline still
  // advances) — just skip the PR.
  if (!forgeBranch || !targetBranch) return;

  // Look up repo from details
  const [projRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, ctx.projectId)).limit(1);
  if (!projRow?.details) throw new Error(`Project ${ctx.projectId} has no details`);
  const d = validateDetails(projRow.details);
  const repoMeta = d.repos.find((r) => r.id === repoId);
  if (!repoMeta) throw new Error(`Repo ${repoId} not found in project details`);

  // Push forge branch to origin
  try {
    execFileSync('git', ['-C', repoMeta.pathOnDisk, 'push', 'origin', forgeBranch, '--force'], { timeout: 60_000 });
  } catch (pushErr) {
    console.error(`[forge] git push failed for ${repoMeta.name}:`, pushErr);
  }

  // Create PR: forgeBranch → targetBranch
  try {
    const [proj] = await db.select({ name: project.name }).from(project).where(eq(project.id, ctx.projectId)).limit(1);
    const tasks = d.stages.plan.phases.refine.tasks
      .filter((t) => !t.targetRepoId || t.targetRepoId === repoId)
      .map((t) => ({ title: t.title, commitSha: t.commitSha ?? null }));

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
        repoPath: repoMeta.pathOnDisk,
        tasks,
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
      await logAction({ projectId: ctx.projectId, memberId: actorId, action: 'create_pr', target: `repo:${repoMeta.name}` }, db);
    }
  } catch (prErr) {
    console.error(`[forge] PR creation failed for ${repoMeta.name}:`, prErr);
  }
}

registerHandler('execute-pipeline', handleExecutePipeline);
