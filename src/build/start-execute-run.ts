import { and, eq, inArray, ne } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import type { Db } from '@/db/client';
import type { MmaClient } from '@/mma/client';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { mmaBatch } from '@/db/schema/ops';
import { planFilePath, readPlanFile } from '@/projects/project-files';
import { buildForgeBranch } from '@/build/execute-core';
import { dispatchMma, PhaseBusyError } from '@/dispatch/dispatch-helpers';
import { validateDetails } from '@/details/schema';
import { updateDetails } from '@/details/write';
import { recordExecuteAttempt } from '@/automation/details-mutations';

export interface ExecuteDispatch {
  repoId: string;
  batchRowId: string;
  forgeBranch: string;
  targetBranch: string;
}
export interface ExecuteRunResult {
  dispatched: ExecuteDispatch[];
  errors: Array<{ repoId: string; error: string }>;
}

/**
 * The SINGLE shared implementation of "start executing the plan", called by BOTH
 * the manual `start-execute` route and the auto driver's `dispatch_execute`. For
 * each repo it ensures the project branch (`mma/<created-date>-<slug>`) exists off
 * `origin/<targetBranch>` and is checked out, then dispatches `execute_plan`
 * ASYNC with the branch meta the `execute-pipeline` handler needs to push and open
 * the PR (project branch → target). MMA edits the checked-out project branch IN PLACE and
 * commits there — it creates no branch and no worktree of its own — so the implementation
 * lands on the project branch and master stays clean. The handler (on async terminal) records the implement attempt
 * that advances the resolver, so the driver only needs the in-flight guard to WAIT.
 */
export async function startExecuteRun(
  db: Db,
  mma: MmaClient,
  projectId: string,
  actorId: string,
  repoList?: Array<{ repoId: string; targetBranch: string }>,
): Promise<ExecuteRunResult> {
  const [proj] = await db
    .select({ name: project.name, details: project.details, createdAt: project.createdAt })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!proj?.details) throw new Error(`Project ${projectId} has no details`);
  const d = validateDetails(proj.details);

  const repos = repoList && repoList.length > 0
    ? repoList
    : d.repos.map((r) => ({ repoId: r.id, targetBranch: r.defaultBranch }));
  if (repos.length === 0) throw new Error('No repos linked to project');

  const planArtifact = await readPlanFile(projectId);
  if (!planArtifact?.bodyMd) throw new Error('No plan artifact');
  // MUST await: planFilePath is async. Unawaited, planPath was a Promise that serialised to
  // `[{}]` in target.paths → MMA rejected every execute_plan dispatch with 400 (retry loop).
  const planPath = await planFilePath(projectId, db);
  // Creation date, not today's — the branch must be stable so retries reuse it.
  const forgeBranch = buildForgeBranch(proj.name ?? projectId, proj.createdAt);

  const dispatched: ExecuteDispatch[] = [];
  const errors: Array<{ repoId: string; error: string }> = [];

  for (const { repoId, targetBranch } of repos) {
    const [repoRow] = await db
      .select({ name: repo.name, pathOnDisk: repo.pathOnDisk })
      .from(repo)
      .where(eq(repo.id, repoId))
      .limit(1);
    if (!repoRow) { errors.push({ repoId, error: 'Repo not found' }); continue; }

    // ONE project at a time per repo CHECKOUT. Since caller-owned branches the engine has no
    // worktree of its own — it edits and commits in THIS clone — so checking our branch out
    // while another project's run is live would swap the tree underneath that run, and its
    // `git add -A` would sweep our files into its commit. Batch rows carry the `cwd`, so an
    // in-flight batch on this path belonging to a DIFFERENT project is the signal to back off.
    // Throwing `PhaseBusyError` reuses the semantics the auto driver already has for "someone
    // else is mid-flight": WAIT and re-resolve, rather than burn a retry or fail the project.
    // Deliberately checked BEFORE the checkout below, which is the only place Forge ever
    // switches branches in a shared clone — that git call is the hazard, not the dispatch.
    const busy = await db
      .select({ projectId: mmaBatch.projectId })
      .from(mmaBatch)
      .where(and(
        eq(mmaBatch.cwd, repoRow.pathOnDisk),
        inArray(mmaBatch.status, ['dispatched', 'running']),
        ne(mmaBatch.projectId, projectId),
      ))
      .limit(1);
    if (busy.length > 0) {
      throw new PhaseBusyError(projectId, 'execute', `repo ${repoRow.name} (held by project ${busy[0].projectId})`);
    }

    // Ensure the project branch: reuse it if it exists, else fork it from
    // origin/<targetBranch>. Execute (and everything after) runs on this branch.
    try {
      const exists = execFileSync('git', ['-C', repoRow.pathOnDisk, 'branch', '--list', forgeBranch], { encoding: 'utf8' }).trim();
      if (exists) {
        execFileSync('git', ['-C', repoRow.pathOnDisk, 'checkout', forgeBranch]);
      } else {
        execFileSync('git', ['-C', repoRow.pathOnDisk, 'fetch', 'origin', targetBranch], { timeout: 30_000 });
        execFileSync('git', ['-C', repoRow.pathOnDisk, 'checkout', '-b', forgeBranch, `origin/${targetBranch}`]);
      }
    } catch (err) {
      errors.push({ repoId, error: `Branch: ${(err as Error).message}` });
      continue;
    }

    try {
      // Auto-authored plans don't tag tasks with a target repo; a single-repo
      // project means every task targets this repo.
      const taskTitles = d.stages.plan.phases.refine.tasks
        .filter((t) => !t.targetRepoId || t.targetRepoId === repoId)
        .map((t) => t.title);
      const { batchRowId } = await dispatchMma({
        db, mma, projectId, route: 'execute_plan', handler: 'execute-pipeline', cwd: repoRow.pathOnDisk,
        body: { type: 'execute_plan', target: { paths: [planPath] }, tasks: [], reviewPolicy: 'reviewed' },
        actorId,
        meta: { forgeBranch, targetBranch, repoId, actorId, tasks: taskTitles },
      });
      await updateDetails(db, projectId, (det) => {
        for (const t of det.stages.plan.phases.refine.tasks) {
          if (!t.targetRepoId || t.targetRepoId === repoId) {
            t.status = 'executing';
            t.targetBranch = targetBranch;
            t.branch = forgeBranch;
          }
        }
        if (det.stages.execute.status === 'pending') det.stages.execute.status = 'active';
        // Record a RUNNING implement attempt at dispatch so the resolver WAITs
        // (not re-dispatches) until the execute-pipeline handler closes it out —
        // closes the terminal-moment race that spawned a duplicate execute.
        recordExecuteAttempt(det, repoId, batchRowId, new Date().toISOString());
        return det;
      });
      dispatched.push({ repoId, batchRowId, forgeBranch, targetBranch });
    } catch (err) {
      errors.push({ repoId, error: `MMA: ${(err as Error).message}` });
    }
  }

  return { dispatched, errors };
}
