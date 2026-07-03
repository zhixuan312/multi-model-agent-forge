import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, buildPr } from '@/db/schema/projects';
import { ProjectEventBus, projectEventBus } from '@/sse/event-bus';
import { BuildScheduler, type RepoMeta, type SchedulerResult } from '@/build/scheduler';
import type { ExecutorDeps, PlanTaskView } from '@/build/executor';
import { reviewRepo, type RunReviewDeps, type ReviewResult } from '@/build/review';
import { createBuildPr, type BuildPrDeps } from '@/build/pr';
import { validateDetails, type Details } from '@/details/schema';
import { updateDetails } from '@/details/write';

/**
 * Build pipeline orchestrator (Spec 7 §SSE monitor / phase machine). Drives the
 * post-freeze pipeline: plan → audit (owned by plan-author + audit-plan-loop) →
 * EXECUTE (the scheduler) → REVIEW, emitting progress to the SSE bus and
 * advancing the stage/phase rows.
 *
 * This module owns the EXECUTE+REVIEW drive (the 7b sequencing). Plan authoring +
 * plan-audit (7a) run upstream; the orchestrator consumes queued plan tasks from details.
 * Every effectful dep is injected so tests drive fakes and NEVER run a real
 * execute-plan; the route handler defaults the execute trigger OFF.
 */

export interface RunExecuteDeps {
  db?: Db;
  bus?: ProjectEventBus;
  executor: Omit<ExecutorDeps, 'db' | 'bus'>;
  review: Omit<RunReviewDeps, 'bus'>;
  pr?: BuildPrDeps;
  maxConcurrentLanes?: number;
}

export interface ExecutePipelineResult {
  scheduler: SchedulerResult;
  reviews: ReviewResult[];
  reachedDone: boolean;
}

/** Load the queued plan tasks for a project from details. */
async function loadQueuedTasks(db: Db, projectId: string): Promise<PlanTaskView[]> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return [];
  const d = validateDetails(row.details);
  return d.stages.plan.phases.refine.tasks.map((t, i) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    reviewPolicy: t.reviewPolicy,
    targetRepoId: t.targetRepoId ?? d.repos[0]?.id ?? '',
    orderIndex: t.orderIndex ?? i,
    dependsOn: t.dependsOn,
    phase: t.phase,
    branch: t.branch,
    targetBranch: t.targetBranch,
    commitSha: t.commitSha,
    fixNote: t.fixNote,
    mmaBatchId: t.mmaBatchId,
    meta: t.meta,
  }));
}

/** Load the project's repos as scheduler RepoMeta from details, keyed by id. */
async function loadRepoMeta(db: Db, projectId: string): Promise<Map<string, RepoMeta>> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return new Map();
  const d = validateDetails(row.details);
  return new Map(d.repos.map((r) => [r.id, { id: r.id, name: r.name, pathOnDisk: r.pathOnDisk, defaultBranch: r.defaultBranch }]));
}

/**
 * Run the execute + review phases for a project, then advance to `learn`.
 *
 * 1. Schedule all queued plan_tasks (one-writer-per-cwd, depends_on, lane cap).
 * 2. For each write-target repo whose tasks committed, run review (advisory).
 * 3. Advance `project.phase='learn'` + mark plan/execute/review stages done (review
 *    NEVER blocks completion; an errored review still lets the pipeline finish).
 */
export async function runExecutePipeline(
  deps: RunExecuteDeps,
  args: { projectId: string; actorId: string; targetBranches?: Record<string, string> },
): Promise<ExecutePipelineResult> {
  const db = deps.db ?? getDb();
  const bus = deps.bus ?? projectEventBus;
  const { projectId, actorId } = args;

  const tasks = await loadQueuedTasks(db, projectId);
  const repos = await loadRepoMeta(db, projectId);

  const scheduler = BuildScheduler.withExecutor(
    { ...deps.executor, db, bus },
    { projectId, actorId },
    { repos, maxConcurrentLanes: deps.maxConcurrentLanes },
  );
  const schedResult = await scheduler.run(tasks);

  // Review each write-target repo that committed at least one task.
  const committedTaskIds = new Set(schedResult.committed);
  const reposWithCommits = new Map<string, RepoMeta>();
  for (const t of tasks) {
    if (committedTaskIds.has(t.id)) {
      const repoId = t.targetRepoId;
      if (repoId) {
        const meta = repos.get(repoId);
        if (meta) reposWithCommits.set(meta.id, meta);
      }
    }
  }

  const reviews: ReviewResult[] = [];
  for (const meta of reposWithCommits.values()) {
    const r = await reviewRepo(
      { ...deps.review, bus },
      { projectId, repoName: meta.name, repoCwd: meta.pathOnDisk, changedFiles: [] },
    );
    reviews.push(r);
  }

  // PR creation for non-halted repos with committed tasks.
  const haltedSet = new Set(schedResult.haltedRepos);
  if (deps.pr) {
    const [projRow] = await db.select({ name: project.name }).from(project).where(eq(project.id, projectId));
    const projectName = projRow?.name ?? projectId;

    for (const [repoId, meta] of repos) {
      if (haltedSet.has(repoId)) continue;
      const repoTasks = tasks.filter((t) => t.targetRepoId === repoId && committedTaskIds.has(t.id));
      if (repoTasks.length === 0) continue;
      const branch = repoTasks[0]!.branch;
      const targetBranch = meta.defaultBranch;
      if (!branch || !targetBranch) continue;

      try {
        const result = await createBuildPr(deps.pr, {
          projectName,
          branch,
          targetBranch,
          repoPath: meta.pathOnDisk,
          tasks: repoTasks.map((t) => ({ title: t.title, commitSha: t.commitSha ?? null })),
        });
        if (result && 'url' in result) {
          await db
            .insert(buildPr)
            .values({ projectId, repoId, url: result.url, branch, targetBranch })
            .onConflictDoUpdate({
              target: [buildPr.projectId, buildPr.repoId],
              set: { url: result.url, branch, targetBranch },
            });
        }
      } catch (err) {
        console.error(`[forge] PR creation failed for repo ${meta.name}`, err);
      }
    }
  }

  // Advance to done via details (review never blocks).
  await updateDetails(db, projectId, (d) => {
    const now = new Date().toISOString();
    for (const kind of ['plan', 'execute', 'review'] as const) {
      d.stages[kind].status = 'done';
      d.stages[kind].completedAt = now;
    }
    return d;
  });
  await db.update(project).set({ phase: 'learn', updatedAt: new Date() }).where(eq(project.id, projectId));

  return { scheduler: schedResult, reviews, reachedDone: true };
}
