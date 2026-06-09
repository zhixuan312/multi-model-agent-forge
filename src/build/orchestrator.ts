import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { planTask, type PlanTaskRow } from '@/db/schema/build';
import { repo } from '@/db/schema/workspace';
import { projectRepo } from '@/db/schema/projects';
import { ProjectEventBus, projectEventBus } from '@/sse/event-bus';
import { BuildScheduler, type RepoMeta, type SchedulerResult } from '@/build/scheduler';
import type { ExecutorDeps } from '@/build/executor';
import { reviewRepo, type RunReviewDeps, type ReviewResult } from '@/build/review';

/**
 * Build pipeline orchestrator (Spec 7 §SSE monitor / phase machine). Drives the
 * post-freeze pipeline: plan → audit (owned by plan-author + audit-plan-loop) →
 * EXECUTE (the scheduler) → REVIEW, emitting progress to the SSE bus and
 * advancing the stage/phase rows.
 *
 * This module owns the EXECUTE+REVIEW drive (the 7b sequencing). Plan authoring +
 * plan-audit (7a) run upstream; the orchestrator consumes queued plan_task rows.
 * Every effectful dep is injected so tests drive fakes and NEVER run a real
 * execute-plan; the route handler defaults the execute trigger OFF.
 */

export interface RunExecuteDeps {
  db?: Db;
  bus?: ProjectEventBus;
  executor: Omit<ExecutorDeps, 'db' | 'bus'>;
  review: Omit<RunReviewDeps, 'bus'>;
  maxConcurrentLanes?: number;
}

export interface ExecutePipelineResult {
  scheduler: SchedulerResult;
  reviews: ReviewResult[];
  reachedDone: boolean;
}

/** Load the queued plan_task rows for a project (the execute input set). */
export async function loadQueuedTasks(db: Db, projectId: string): Promise<PlanTaskRow[]> {
  return db
    .select()
    .from(planTask)
    .where(eq(planTask.projectId, projectId));
}

/** Load the project's repos as scheduler RepoMeta, keyed by id. */
export async function loadRepoMeta(db: Db, projectId: string): Promise<Map<string, RepoMeta>> {
  const rows = await db
    .select({
      id: repo.id,
      name: repo.name,
      pathOnDisk: repo.pathOnDisk,
      kind: repo.kind,
      defaultBranch: repo.defaultBranch,
    })
    .from(projectRepo)
    .innerJoin(repo, eq(projectRepo.repoId, repo.id))
    .where(eq(projectRepo.projectId, projectId));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Run the execute + review phases for a project, then advance to `done`.
 *
 * 1. Schedule all queued plan_tasks (one-writer-per-cwd, depends_on, lane cap).
 * 2. For each write-target repo whose tasks committed, run review (advisory).
 * 3. Advance `project.phase='done'` + mark plan/execute/review stages done (review
 *    NEVER blocks `done`; an errored review still lets the pipeline finish).
 */
export async function runExecutePipeline(
  deps: RunExecuteDeps,
  args: { projectId: string; actorId: string },
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
      const meta = repos.get(t.targetRepoId);
      if (meta) reposWithCommits.set(meta.id, meta);
    }
  }

  const reviews: ReviewResult[] = [];
  for (const meta of reposWithCommits.values()) {
    const changedFiles = await collectChangedFiles(db, projectId, meta.id);
    const r = await reviewRepo(
      { ...deps.review, bus },
      { projectId, repoName: meta.name, repoCwd: meta.pathOnDisk, changedFiles },
    );
    reviews.push(r);
  }

  // Advance to done (review never blocks; an errored review is "done (advisory)").
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx.update(project).set({ phase: 'done', updatedAt: now }).where(eq(project.id, projectId));
    for (const kind of ['plan', 'execute', 'review'] as const) {
      await tx
        .update(stage)
        .set({ status: 'done', completedAt: now })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, kind)));
    }
  });

  return { scheduler: schedResult, reviews, reachedDone: true };
}

/** Collect the changed file paths across a repo's committed tasks (review scope). */
async function collectChangedFiles(db: Db, projectId: string, repoId: string): Promise<string[]> {
  const rows = await db
    .select({ meta: planTask.meta })
    .from(planTask)
    .where(and(eq(planTask.projectId, projectId), eq(planTask.targetRepoId, repoId), eq(planTask.status, 'committed')));
  // We don't persist per-file lists on plan_task; the review falls back to the
  // working tree when this is empty. (Kept as a seam for a future file ledger.)
  void rows;
  return [];
}
