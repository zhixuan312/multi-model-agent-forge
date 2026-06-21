import type { PlanTaskRow } from '@/db/schema/build';
import type { RepoContext, ExecutorDeps, TaskOutcome } from '@/build/executor';
import { executeTask } from '@/build/executor';

/**
 * Build scheduler (Spec 7 §Execute, `BuildScheduler`; the 7b orchestration core).
 *
 * Drives queued plan_tasks to completion / halt with:
 *  - depends_on gating: a task dispatches only when EVERY id in depends_on is
 *    committed/skipped.
 *  - per-cwd serialization: at most one in-flight execute-plan batch per
 *    target_repo_id (one writer per cwd — concurrent same-cwd writers race the
 *    git index).
 *  - cross-repo parallelism, capped at MAX_CONCURRENT_LANES (overflow queued).
 *  - lane halt: a failed / halted task stops ITS repo's lane (don't run
 *    dependents on a broken base); other repos' lanes keep running.
 *
 * The executor (per-task) is injected via `runTask` so the scheduler is unit
 * testable with a fake that records dispatch order without real execution.
 */

export const MAX_CONCURRENT_LANES = 4;

export interface RepoMeta {
  id: string;
  name: string;
  pathOnDisk: string;
  defaultBranch: string;
}

/** The per-task runner the scheduler calls (default = the real executor). */
export type RunTaskFn = (task: PlanTaskRow, repo: RepoContext) => Promise<TaskOutcome>;

export interface SchedulerResult {
  committed: string[];
  failed: string[];
  halted: string[];
  /** Repos whose lanes halted (a failure/halt stopped further tasks there). */
  haltedRepos: string[];
}

export interface BuildSchedulerOptions {
  maxConcurrentLanes?: number;
  /** Repos by id (for the RepoContext fed to the executor). */
  repos: Map<string, RepoMeta>;
}

export class BuildScheduler {
  private readonly maxLanes: number;
  private readonly repos: Map<string, RepoMeta>;
  private readonly runTask: RunTaskFn;

  /** Construct with an injected per-task runner (tests pass a fake). */
  constructor(runTask: RunTaskFn, opts: BuildSchedulerOptions) {
    this.runTask = runTask;
    this.maxLanes = opts.maxConcurrentLanes ?? MAX_CONCURRENT_LANES;
    this.repos = opts.repos;
  }

  /** Build a scheduler wired to the real per-task executor. */
  static withExecutor(
    deps: Omit<ExecutorDeps, never>,
    args: { projectId: string; actorId: string },
    opts: BuildSchedulerOptions,
  ): BuildScheduler {
    const runTask: RunTaskFn = (task, repo) =>
      executeTask(deps, { task, repo, projectId: args.projectId, actorId: args.actorId });
    return new BuildScheduler(runTask, opts);
  }

  /**
   * Run all tasks. `tasks` is the full queued set (with depends_on as id[]).
   * Resolves when every task is terminal (committed/failed/halted/skipped-by-halt).
   */
  async run(tasks: PlanTaskRow[]): Promise<SchedulerResult> {
    const done = new Map<string, 'committed' | 'failed' | 'halted'>();
    const haltedRepos = new Set<string>();
    const firstTaskSeen = new Set<string>(); // repos that have started their first task
    const inFlightRepos = new Set<string>(); // one writer per cwd

    const committed: string[] = [];
    const failed: string[] = [];
    const halted: string[] = [];

    const isReady = (t: PlanTaskRow): boolean => {
      if (haltedRepos.has(t.targetRepoId)) return false;
      for (const dep of t.dependsOn ?? []) {
        const d = done.get(dep);
        if (d !== 'committed') return false; // dependents wait on a committed predecessor
      }
      return true;
    };

    const remaining = (): PlanTaskRow[] => tasks.filter((t) => !done.has(t.id) && !haltedRepos.has(t.targetRepoId));

    // Order tasks within a repo by order_index for sequential dispatch.
    const sorted = [...tasks].sort((a, b) => a.orderIndex - b.orderIndex);

    const runOne = async (task: PlanTaskRow): Promise<void> => {
      inFlightRepos.add(task.targetRepoId);
      const meta = this.repos.get(task.targetRepoId)!;
      const firstTask = !firstTaskSeen.has(task.targetRepoId);
      firstTaskSeen.add(task.targetRepoId);
      const repoCtx: RepoContext = { ...meta, firstTask };
      try {
        const outcome = await this.runTask(task, repoCtx);
        if (outcome.status === 'committed') {
          done.set(task.id, 'committed');
          committed.push(task.id);
        } else if (outcome.status === 'halt') {
          done.set(task.id, 'halted');
          halted.push(task.id);
          haltedRepos.add(task.targetRepoId);
        } else {
          done.set(task.id, 'failed');
          failed.push(task.id);
          haltedRepos.add(task.targetRepoId);
        }
      } catch (err) {
        done.set(task.id, 'failed');
        failed.push(task.id);
        haltedRepos.add(task.targetRepoId);
        void err;
      } finally {
        inFlightRepos.delete(task.targetRepoId);
      }
    };

    // Event-loop driven dispatcher: launch ready tasks (respecting per-cwd
    // exclusivity + the lane cap), await the first to settle, repeat.
    const active = new Set<Promise<void>>();
    for (;;) {
      // Launch as many ready tasks as the cap + per-cwd rule allow.
      let launched = false;
      for (const task of sorted) {
        if (active.size >= this.maxLanes) break;
        if (done.has(task.id)) continue;
        if (inFlightRepos.has(task.targetRepoId)) continue; // one writer per cwd
        if (!isReady(task)) continue;
        const p = runOne(task).then(() => {
          active.delete(p);
        });
        active.add(p);
        launched = true;
      }

      if (active.size === 0) {
        // Nothing in flight. If work remains but is all blocked (halted-repo /
        // unsatisfiable deps), we're done.
        if (remaining().length === 0 || !launched) break;
      }
      if (active.size > 0) {
        await Promise.race(active);
      } else if (!launched) {
        break;
      }
    }

    return { committed, failed, halted, haltedRepos: [...haltedRepos] };
  }
}
