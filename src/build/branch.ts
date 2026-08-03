import { execFile } from 'node:child_process';
// Git children run in checkouts MMA WORKERS write to, and several of these commands fire
// repo hooks (`push` → pre-push, worktree add/checkout → post-checkout). Inheriting the
// parent environment would hand a planted hook FORGE_SECRET_KEY, DATABASE_URL and every
// provider key. `safeChildEnv` keeps PATH and HOME, so git stays findable and any
// credential helper in ~/.gitconfig keeps working; only credential-shaped variables go.
import { safeChildEnv } from '@/build/command-runner';

/**
 * Injectable git runner + worktree-add-with-retry (Forge-owned). `nodeGitRunner`
 * runs `git -C <repoPath> <argv>` with retry-on-lock, and `addWorktreeWithRetry`
 * does cleanup-aware retry for the non-idempotent `git worktree add`. Consumed by
 * the Loops engine (src/loops/run-deps.ts). All git runs through an injected
 * `GitRunner` (args array, never a shell string) so `repo.name`/branch tokens can't
 * inject and tests can assert the exact command sequence without touching disk.
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
      { timeout: DEFAULT_GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: safeChildEnv() as NodeJS.ProcessEnv },
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
export const GIT_LOCK_RE =
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

/** `already exists` / `already checked out` — the partial-add signature, distinct from a lock. */
const ALREADY_RE = /already (exists|checked out|used by worktree)/i;

/**
 * `git worktree add -b <branch> <path> <base>` with cleanup-aware retry. Concurrent
 * same-repo adds race the shared `.git/config` lock; a partial run leaves the branch
 * (and maybe the worktree dir) behind, so before each retry we tear those down —
 * making the add idempotent. Returns the final GitRunResult (caller checks `code`).
 *
 * ## It will not delete a branch it did not create
 *
 * The cleanup includes `branch -D`, a FORCE delete. That is right for the partial state of
 * an add that just failed — the branch is at base with nothing on it — and destroys real
 * work if the branch was already there. `project-worktree.ts` records this in its own
 * docstring and deliberately does not use this helper for project branches, which is
 * correct and also means the rule lives in a different file from the `-D`.
 *
 * So the precondition is checked here instead of assumed. The branch is looked up BEFORE
 * the first attempt: if it already existed, it is not ours to delete, and an
 * `already exists` failure is returned rather than retried — retrying could only either
 * destroy it or fail again. Lock contention still retries either way; it just cleans up
 * the worktree path and leaves refs alone.
 */
export async function addWorktreeWithRetry(
  run: GitRunner,
  repoPath: string,
  branch: string,
  path: string,
  baseRef: string,
): Promise<GitRunResult> {
  const maxAttempts = 8;
  const preExisting =
    (await run(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).catch(() => ({ code: 1 })))
      .code === 0;

  const shouldRetry = (res: GitRunResult): boolean =>
    res.code !== 0 && (GIT_LOCK_RE.test(res.stderr) || (!preExisting && ALREADY_RE.test(res.stderr)));

  // Through the INJECTED runner, like every other command here. This called `runGitOnce`
  // directly, so the one command the function exists to run was the one command a test
  // could not observe — under a module docstring promising the opposite. `nodeGitRunner`
  // gives `worktree add` a single attempt by design, so this is the same behaviour.
  let res = await run(repoPath, ['worktree', 'add', '-b', branch, path, baseRef]);
  for (let attempt = 1; attempt < maxAttempts && shouldRetry(res); attempt++) {
    // Tear down partial state from the failed attempt (best-effort) so the retry starts clean.
    await run(repoPath, ['worktree', 'remove', '--force', path]).catch(() => undefined);
    await run(repoPath, ['worktree', 'prune']).catch(() => undefined);
    if (!preExisting) await run(repoPath, ['branch', '-D', branch]).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50 * attempt));
    res = await run(repoPath, ['worktree', 'add', '-b', branch, path, baseRef]);
  }
  return res;
}
