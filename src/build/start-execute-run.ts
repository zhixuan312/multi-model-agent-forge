import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import type { MmaClient } from '@/mma/client';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { planFilePath, readPlanFile } from '@/projects/project-files';
import { buildForgeBranch } from '@/build/execute-core';
import { ensureProjectWorktree } from '@/build/project-worktree';
import { dispatchMma } from '@/dispatch/dispatch-helpers';
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
 * `origin/<targetBranch>` and is checked out IN THIS PROJECT'S OWN WORKTREE, then
 * dispatches `execute_plan` ASYNC with the branch meta the `execute-pipeline` handler
 * needs to push and open the PR (project branch → target). MMA edits that worktree in
 * place and commits there — it creates no branch and no worktree of its own — so the
 * implementation lands on the project branch and master stays clean. The handler (on
 * async terminal) records the implement attempt that advances the resolver, so the
 * driver only needs the in-flight guard to WAIT.
 *
 * The worktree is what keeps projects that share a repo from colliding; see
 * `build/project-worktree.ts` for why a shared clone was unsafe.
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

    // Check the project branch out in THIS PROJECT'S OWN worktree, exactly as a loop run
    // gets its own. Several projects can target one repo, so working in the shared clone
    // meant a second project's checkout could swap the tree out from under the first
    // project's running engine. A private checkout removes that shared state outright —
    // no scheduling, no waiting, and it is where every later stage operates too.
    let worktree: string;
    try {
      worktree = await ensureProjectWorktree({
        repoPathOnDisk: repoRow.pathOnDisk, projectId, branch: forgeBranch, targetBranch,
      });
    } catch (err) {
      errors.push({ repoId, error: `Worktree: ${(err as Error).message}` });
      continue;
    }

    try {
      // `tasks[]` is a heading selector and EMPTY means "run the whole plan".
      //
      // Empty is the only honest value today, INCLUDING for multi-repo projects. Scoping a
      // dispatch to one repo's tasks needs tasks to carry a repo, and nothing populates
      // `planTask.targetRepoId`: `plan-author` creates every task without it, and the
      // engine's plan format has no per-task repo field — a plan is scoped to ONE
      // repository by construction, while Forge authors one plan for N linked repos.
      //
      // A filter over that field therefore matches every task, so sending the full title
      // list would only swap "run the whole plan" for "run these N headings" — no scoping
      // gained, and a heading the engine's matcher doesn't recognise would silently drop
      // work. See the audit note on per-task repo assignment; it is a plan-format decision,
      // not something to infer here.
      const { batchRowId } = await dispatchMma({
        db, mma, projectId, route: 'execute_plan', handler: 'execute-pipeline', cwd: worktree,
        body: { type: 'execute_plan', target: { paths: [planPath] }, tasks: [], reviewPolicy: 'reviewed' },
        actorId,
        // No `tasks` in meta either: it rode there as dead payload — the execute-pipeline
        // handler declares the field and never reads it, recomputing from details instead.
        meta: { forgeBranch, targetBranch, repoId, actorId },
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
