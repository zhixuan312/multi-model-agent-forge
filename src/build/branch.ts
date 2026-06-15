import { execFile } from 'node:child_process';
import { branchName, slugRefComponent, projectShortId } from '@/build/slug';

/**
 * Per-run branch git-ops (Spec 7 §Execute step 1; Forge-owned — MMA never
 * branches). Forge prepares `forge/<project-short-id>/<repo>` BEFORE each task so
 * MMA's commit stage (which commits on the CURRENT branch and FAILS on detached
 * HEAD) lands on the right branch. Local-only: no push/PR.
 *
 * All git runs through an injected `GitRunner` (args array, never a shell string)
 * so tests assert the exact `checkout -b`/`checkout` sequence without touching
 * disk, and `repo.name`/branch tokens can't inject.
 */

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** The injected git invoker: `git -C <repoPath> <args...>`. */
export type GitRunner = (
  repoPath: string,
  argv: string[],
) => Promise<GitRunResult>;

export const DEFAULT_GIT_TIMEOUT_MS = 120_000;

const runGitOnce = (repoPath: string, argv: string[]): Promise<GitRunResult> =>
  new Promise<GitRunResult>((resolve) => {
    execFile(
      'git',
      ['-C', repoPath, ...argv],
      { timeout: DEFAULT_GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number'
          ? (err as { code: number }).code
          : err ? 1 : 0;
        resolve({ code, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
      },
    );
  });

/**
 * Concurrent loop runs on the SAME repo race the shared `.git/config` + ref locks
 * during `git worktree add`/`remove`/`branch` (they register the new tree in the
 * common `.git`). Those locks are held for milliseconds, so the contention is
 * transient — retry on the lock signature rather than serialize, which lets N
 * simultaneous loops on one repo each get their own worktree + branch + PR.
 * A non-lock non-zero exit (e.g. `rev-parse --verify` of a missing ref) does NOT
 * match and is returned immediately.
 */
const GIT_LOCK_RE =
  /could not lock config file|File exists|Unable to create|index\.lock|cannot lock ref|another git process|\.lock'/i;

/** Default runner — `git -C <repoPath> <argv>` (no shell), with retry-on-lock.
 *  `worktree add` is EXCLUDED: it's non-idempotent (a partial run creates the
 *  branch, so a blind retry fails with "branch already exists"). Its caller
 *  (`addWorktreeWithRetry`) does cleanup-aware retry instead. */
export const nodeGitRunner: GitRunner = async (repoPath, argv) => {
  const isWorktreeAdd = argv[0] === 'worktree' && argv[1] === 'add';
  const maxAttempts = isWorktreeAdd ? 1 : 8;
  let res = await runGitOnce(repoPath, argv);
  for (let attempt = 1; attempt < maxAttempts && res.code !== 0 && GIT_LOCK_RE.test(res.stderr); attempt++) {
    await new Promise((r) => setTimeout(r, 50 * attempt));
    res = await runGitOnce(repoPath, argv);
  }
  return res;
};

/**
 * `git worktree add -b <branch> <path> <base>` with cleanup-aware retry. Concurrent
 * same-repo adds race the shared `.git/config` lock; a partial run leaves the branch
 * (and maybe the worktree dir) behind, so before each retry we tear those down —
 * making the add idempotent. Returns the final GitRunResult (caller checks `code`).
 */
export async function addWorktreeWithRetry(
  run: GitRunner,
  repoPath: string,
  branch: string,
  path: string,
  baseRef: string,
): Promise<GitRunResult> {
  const maxAttempts = 8;
  let res = await runGitOnce(repoPath, ['worktree', 'add', '-b', branch, path, baseRef]);
  for (
    let attempt = 1;
    attempt < maxAttempts && res.code !== 0 && (GIT_LOCK_RE.test(res.stderr) || /already (exists|checked out|used by worktree)/i.test(res.stderr));
    attempt++
  ) {
    // Tear down partial state from the failed attempt (best-effort) so the retry starts clean.
    await run(repoPath, ['worktree', 'remove', '--force', path]).catch(() => undefined);
    await run(repoPath, ['worktree', 'prune']).catch(() => undefined);
    await run(repoPath, ['branch', '-D', branch]).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50 * attempt));
    res = await runGitOnce(repoPath, ['worktree', 'add', '-b', branch, path, baseRef]);
  }
  return res;
};

export type BranchPrepError =
  | 'detached_head'
  | 'dirty_tree'
  | 'not_cloned'
  | 'default_branch_missing'
  | 'invalid_ref_name'
  | 'checkout_failed';

export class GitOpsError extends Error {
  readonly reason: BranchPrepError;
  constructor(reason: BranchPrepError, message: string) {
    super(message);
    this.name = 'GitOpsError';
    this.reason = reason;
  }
}

export interface PreparedBranch {
  branch: string;
  /** The branch HEAD SHA captured before dispatch (baseline for self-commit/diff). */
  headBefore: string;
}

export class GitOps {
  private readonly run: GitRunner;
  constructor(run: GitRunner = nodeGitRunner) {
    this.run = run;
  }

  /** The per-run branch name for a repo (slugged; validated in `prepareBranch`). */
  branchFor(projectId: string, repoName: string): string {
    return branchName(projectId, repoName);
  }

  /** Whether two repo names collide on the same sanitized slug (F22 precheck). */
  static collisionCheck(repoNames: string[]): { slug: string; repos: string[] } | null {
    const bySlug = new Map<string, string[]>();
    for (const n of repoNames) {
      const slug = slugRefComponent(n);
      const arr = bySlug.get(slug) ?? [];
      arr.push(n);
      bySlug.set(slug, arr);
    }
    for (const [slug, repos] of bySlug) {
      if (repos.length > 1) return { slug, repos };
    }
    return null;
  }

  /**
   * Prepare the per-run branch in `repoPath` (Spec 7 §Execute step 1).
   *  - Reassert attached + clean HEAD (halt on detached / dirty) — BEFORE EVERY TASK.
   *  - Validate the branch ref-name (`git check-ref-format --branch`).
   *  - First task in the repo: `checkout <default>` then `checkout -b <branch>`
   *    (or `checkout <branch>` if it already exists — resumed run). Subsequent
   *    tasks: assert we are on `<branch>`.
   *  - Capture `headBefore` (the branch HEAD SHA) for the post-task checks.
   *
   * `firstTask` distinguishes the create-branch vs assert-current path.
   */
  async prepareBranch(args: {
    repoPath: string;
    projectId: string;
    repoName: string;
    defaultBranch: string;
    firstTask: boolean;
  }): Promise<PreparedBranch> {
    const branch = this.branchFor(args.projectId, args.repoName);

    // 0. Validate the ref-name before any mutation (F25).
    const fmt = await this.run(args.repoPath, ['check-ref-format', '--branch', branch]);
    if (fmt.code !== 0) {
      throw new GitOpsError('invalid_ref_name', `Branch name "${branch}" is not a valid git ref.`);
    }

    // 1. Repo cloned? (a non-zero rev-parse means no repo / partial clone.)
    const isRepo = await this.run(args.repoPath, ['rev-parse', '--is-inside-work-tree']);
    if (isRepo.code !== 0 || isRepo.stdout.trim() !== 'true') {
      throw new GitOpsError('not_cloned', `Repo at "${args.repoPath}" is not a git work tree.`);
    }

    // 2. Attached HEAD? (detached HEAD → MMA would no_op silently — halt.)
    const head = await this.run(args.repoPath, ['symbolic-ref', '-q', 'HEAD']);
    if (head.code !== 0) {
      throw new GitOpsError('detached_head', `Repo "${args.repoName}" is in detached HEAD — resolve before build.`);
    }

    // 3. Clean tree? (uncommitted changes → halt; never auto-stash.)
    const status = await this.run(args.repoPath, ['status', '--porcelain']);
    if (status.stdout.trim().length > 0) {
      throw new GitOpsError('dirty_tree', `Repo "${args.repoName}" has uncommitted changes — resolve before build.`);
    }

    if (args.firstTask) {
      // Does the per-run branch already exist (resumed run)?
      const exists = await this.run(args.repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      if (exists.code === 0) {
        const co = await this.run(args.repoPath, ['checkout', branch]);
        if (co.code !== 0) throw new GitOpsError('checkout_failed', `checkout ${branch} failed.`);
      } else {
        // default_branch must resolve locally.
        const dft = await this.run(args.repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${args.defaultBranch}`]);
        if (dft.code !== 0) {
          throw new GitOpsError('default_branch_missing', `Default branch "${args.defaultBranch}" is not a local ref.`);
        }
        const coDefault = await this.run(args.repoPath, ['checkout', args.defaultBranch]);
        if (coDefault.code !== 0) throw new GitOpsError('checkout_failed', `checkout ${args.defaultBranch} failed.`);
        const create = await this.run(args.repoPath, ['checkout', '-b', branch]);
        if (create.code !== 0) throw new GitOpsError('checkout_failed', `checkout -b ${branch} failed.`);
      }
    } else {
      // Subsequent task — assert we're on the branch (no new branch).
      const cur = await this.run(args.repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (cur.stdout.trim() !== branch) {
        const co = await this.run(args.repoPath, ['checkout', branch]);
        if (co.code !== 0) throw new GitOpsError('checkout_failed', `not on ${branch} and checkout failed.`);
      }
    }

    const headBefore = (await this.run(args.repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
    return { branch, headBefore };
  }

  /** Count the commits in `head_before..HEAD` (self-commit check). */
  async commitsSince(repoPath: string, headBefore: string): Promise<string[]> {
    const r = await this.run(repoPath, ['rev-list', `${headBefore}..HEAD`]);
    return r.stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  }

  /** Whether `git diff head_before..HEAD` is non-empty (real changes landed). */
  async hasDiffSince(repoPath: string, headBefore: string): Promise<boolean> {
    const r = await this.run(repoPath, ['diff', '--quiet', `${headBefore}..HEAD`]);
    // `--quiet` exits 1 when there IS a diff, 0 when none.
    return r.code !== 0;
  }

  /** Commit a Forge inline fix on the current branch (the ONE sanctioned 2nd commit). */
  async commitInlineFix(repoPath: string, message: string): Promise<string> {
    await this.run(repoPath, ['add', '-A']);
    const commit = await this.run(repoPath, ['commit', '-m', message]);
    if (commit.code !== 0) {
      throw new GitOpsError('checkout_failed', `inline-fix commit failed: ${commit.stderr.trim()}`);
    }
    return (await this.run(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
  }
}

/** Re-export the slug helpers callers reach for alongside GitOps. */
export { branchName, projectShortId };
