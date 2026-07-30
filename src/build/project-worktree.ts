import { mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { nodeGitRunner, type GitRunner } from '@/build/branch';

/**
 * Per-project git worktrees — the project-side counterpart of the loop worktrees in
 * `loops/run-deps.ts`.
 *
 * Every project that targets a repo used to work in that repo's ONE shared clone, so a
 * second project starting execute would `git checkout` the clone out from under the first
 * project's still-running engine. `git checkout -b` does not refuse a dirty tree — it
 * carries the changes across — so the first project's engine then committed onto the second
 * project's branch: an empty PR for one, a silently polluted branch for the other. Giving
 * each project its own checkout removes the shared mutable state instead of scheduling
 * around it.
 *
 * The path is DERIVED, not stored, so every later stage (execute → review → apply → PR)
 * resolves the same directory from `(repo path, project id)` alone — nothing to thread
 * through `details` or the batch meta, and nothing to migrate for existing projects.
 *
 * Unlike a loop run, a project's worktree is LONG-LIVED: it must survive from execute
 * through review, fix-apply and PR, which can span days of human review. It is removed when
 * the project is archived.
 */

/** Where a project's checkouts live — beside the repo, mirroring `.forge-loop-worktrees`. */
const PROJECT_WORKTREE_DIR = '.forge-project-worktrees';

/**
 * Stable checkout path for one (project, repo) pair.
 *
 * Keyed by repo DIRECTORY name rather than repo id: the id is not in scope at every call
 * site, while the path always is, and directory names are already unique within a team's
 * workspace root (they are what `pathOnDisk` is built from).
 */
export function projectWorktreePath(repoPathOnDisk: string, projectId: string): string {
  return join(dirname(repoPathOnDisk), PROJECT_WORKTREE_DIR, `${projectId}-${basename(repoPathOnDisk)}`);
}

/** Lock contention on the shared `.git` is transient; a missing ref is not. Retry only locks. */
const GIT_LOCK_RE =
  /could not lock config file|File exists|Unable to create|index\.lock|cannot lock ref|another git process|\.lock'/i;

async function addWorktree(run: GitRunner, repoPath: string, argv: string[]): Promise<void> {
  let res = await run(repoPath, argv);
  for (let attempt = 1; attempt < 8 && res.code !== 0 && GIT_LOCK_RE.test(res.stderr); attempt++) {
    await run(repoPath, ['worktree', 'prune']).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50 * attempt));
    res = await run(repoPath, argv);
  }
  if (res.code !== 0) throw new Error(`git ${argv.join(' ')} failed: ${res.stderr.trim() || res.stdout.trim()}`);
}

/**
 * Ensure the project's branch is checked out in the project's own worktree, and return its
 * path. Idempotent: safe to call on every execute dispatch, including retries.
 *
 * Deliberately NOT `addWorktreeWithRetry` (used by loops). That helper's retry does
 * `branch -D` to clear partial state, which is correct for a loop's throwaway per-run branch
 * and catastrophic for a project branch carrying committed work. Here a lock retries and
 * anything else throws.
 */
export async function ensureProjectWorktree(args: {
  repoPathOnDisk: string;
  projectId: string;
  branch: string;
  targetBranch: string;
  run?: GitRunner;
}): Promise<string> {
  const { repoPathOnDisk, projectId, branch, targetBranch } = args;
  const run = args.run ?? nodeGitRunner;
  const path = projectWorktreePath(repoPathOnDisk, projectId);

  mkdirSync(join(dirname(repoPathOnDisk), PROJECT_WORKTREE_DIR), { recursive: true });
  // Drop registrations whose directory is gone (a crashed run, or a manually deleted dir),
  // otherwise `worktree add` refuses the path as already registered.
  await run(repoPathOnDisk, ['worktree', 'prune']).catch(() => undefined);

  // Already checked out here on the right branch — the common case on retries and on every
  // stage after execute.
  const current = await run(path, ['branch', '--show-current']).catch(() => null);
  if (current && current.code === 0 && current.stdout.trim() === branch) return path;

  // A branch can only be checked out in ONE worktree. Projects created before per-project
  // worktrees left their branch checked out in the shared clone, which would make the add
  // fail with "already checked out"; detaching frees the branch and leaves the clone in the
  // state it should now always be in — not sitting on any project's branch.
  const mainHead = await run(repoPathOnDisk, ['branch', '--show-current']).catch(() => null);
  if (mainHead && mainHead.code === 0 && mainHead.stdout.trim() === branch) {
    await run(repoPathOnDisk, ['checkout', '--detach']).catch(() => undefined);
  }

  const branchExists = await run(repoPathOnDisk, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (branchExists.code === 0) {
    // Reuse the existing branch — it carries this project's committed work.
    await addWorktree(run, repoPathOnDisk, ['worktree', 'add', path, branch]);
  } else {
    // First execute for this project+repo: fork the branch off the FRESH remote base.
    await run(repoPathOnDisk, ['fetch', 'origin', targetBranch]).catch(() => undefined);
    const remoteRef = `origin/${targetBranch}`;
    const hasRemote = (await run(repoPathOnDisk, ['rev-parse', '--verify', '--quiet', remoteRef])).code === 0;
    await addWorktree(run, repoPathOnDisk, ['worktree', 'add', '-b', branch, path, hasRemote ? remoteRef : targetBranch]);
  }
  return path;
}

/**
 * Remove a project's checkout. Best-effort: the branch is deliberately left alone, so the
 * work (and any open PR) survives; only the working directory is reclaimed.
 */
export async function removeProjectWorktree(args: {
  repoPathOnDisk: string;
  projectId: string;
  run?: GitRunner;
}): Promise<void> {
  const run = args.run ?? nodeGitRunner;
  const path = projectWorktreePath(args.repoPathOnDisk, args.projectId);
  await run(args.repoPathOnDisk, ['worktree', 'remove', '--force', path]).catch(() => undefined);
  await run(args.repoPathOnDisk, ['worktree', 'prune']).catch(() => undefined);
}
