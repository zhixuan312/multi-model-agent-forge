// @vitest-environment node
/**
 * `addWorktreeWithRetry` — the retry that force-deletes a branch.
 *
 * Its cleanup runs `git branch -D`. That is right for the partial state of an add that just
 * failed (the branch is at base, carrying nothing) and destroys real work if the branch was
 * already there. `project-worktree.ts` documents the distinction and avoids this helper for
 * project branches — which is correct, and also put the rule in a different file from the
 * `-D`, where a future caller will not see it.
 *
 * Nothing tested any of it: the `worktree add` bypassed the injected runner and called the
 * real `git`, so the one command the function exists to run was the one a test could not
 * observe.
 */
import type { GitRunResult, GitRunner } from '@/build/branch';
import { addWorktreeWithRetry, GIT_LOCK_RE } from '@/build/branch';

const ok: GitRunResult = { code: 0, stdout: '', stderr: '' };
const fail = (stderr: string): GitRunResult => ({ code: 1, stdout: '', stderr });

const LOCK = fail("fatal: could not lock config file .git/config: File exists");
const EXISTS = fail("fatal: a branch named 'mma/x' already exists");

/**
 * A runner that records every argv and replies from a script keyed by the command's first
 * two words, so each test states only what it cares about.
 */
function runner(script: {
  branchExists?: boolean;
  addResults?: GitRunResult[];
}): GitRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const adds = [...(script.addResults ?? [ok])];
  const fn = (async (_repoPath: string, argv: string[]) => {
    calls.push(argv);
    if (argv[0] === 'rev-parse') return script.branchExists ? ok : fail('');
    if (argv[0] === 'worktree' && argv[1] === 'add') return adds.shift() ?? ok;
    return ok;
  }) as GitRunner & { calls: string[][] };
  fn.calls = calls;
  return fn;
}

const isCmd = (argv: string[], ...words: string[]) => words.every((w, i) => argv[i] === w);

describe('addWorktreeWithRetry', () => {
  it('adds the worktree through the injected runner', async () => {
    const run = runner({});
    const res = await addWorktreeWithRetry(run, '/repo', 'mma/x', '/wt', 'origin/main');

    expect(res.code).toBe(0);
    expect(run.calls.some((c) => isCmd(c, 'worktree', 'add', '-b', 'mma/x', '/wt', 'origin/main'))).toBe(true);
  });

  /**
   * The destructive case. A branch that already exists is not partial state from a failed
   * attempt — it is somebody's work, possibly with commits on it. The old retry fired on
   * this stderr and force-deleted it on the very first iteration.
   */
  it('never force-deletes a branch that existed before it started', async () => {
    const run = runner({ branchExists: true, addResults: [EXISTS] });
    const res = await addWorktreeWithRetry(run, '/repo', 'mma/x', '/wt', 'origin/main');

    expect(run.calls.some((c) => isCmd(c, 'branch', '-D'))).toBe(false);
    // And it does not spin: retrying could only destroy the branch or fail again.
    expect(run.calls.filter((c) => isCmd(c, 'worktree', 'add')).length).toBe(1);
    expect(res.code).toBe(1);
  });

  it('does clear its OWN partial state — a branch left by a failed add', async () => {
    const run = runner({ branchExists: false, addResults: [EXISTS, ok] });
    const res = await addWorktreeWithRetry(run, '/repo', 'mma/x', '/wt', 'origin/main');

    expect(run.calls.some((c) => isCmd(c, 'branch', '-D', 'mma/x'))).toBe(true);
    expect(res.code).toBe(0);
  });

  it('retries lock contention on a pre-existing branch, but touches no refs', async () => {
    const run = runner({ branchExists: true, addResults: [LOCK, ok] });
    const res = await addWorktreeWithRetry(run, '/repo', 'mma/x', '/wt', 'origin/main');

    expect(res.code).toBe(0);
    expect(run.calls.filter((c) => isCmd(c, 'worktree', 'add')).length).toBe(2);
    expect(run.calls.some((c) => isCmd(c, 'branch', '-D'))).toBe(false);
    // The worktree path is still cleaned between attempts — that is not a ref.
    expect(run.calls.some((c) => isCmd(c, 'worktree', 'remove', '--force', '/wt'))).toBe(true);
  });

  it('returns a non-lock, non-exists failure immediately', async () => {
    const run = runner({ addResults: [fail('fatal: invalid reference: origin/nope')] });
    const res = await addWorktreeWithRetry(run, '/repo', 'mma/x', '/wt', 'origin/nope');

    expect(res.code).toBe(1);
    expect(run.calls.filter((c) => isCmd(c, 'worktree', 'add')).length).toBe(1);
  });

  it('gives up after a bounded number of attempts rather than looping forever', async () => {
    const run = runner({ addResults: Array.from({ length: 20 }, () => LOCK) });
    const res = await addWorktreeWithRetry(run, '/repo', 'mma/x', '/wt', 'origin/main');

    expect(res.code).toBe(1);
    expect(run.calls.filter((c) => isCmd(c, 'worktree', 'add')).length).toBe(8);
  });

  it('treats a rev-parse that throws as "branch not there"', async () => {
    // The probe must never be the thing that fails the add.
    const run = (async (_p: string, argv: string[]) => {
      if (argv[0] === 'rev-parse') throw new Error('git missing');
      return ok;
    }) as GitRunner;
    await expect(addWorktreeWithRetry(run, '/repo', 'mma/x', '/wt', 'origin/main')).resolves.toMatchObject({ code: 0 });
  });
});

describe('GIT_LOCK_RE', () => {
  it('matches the lock signatures it is retried on', () => {
    expect(GIT_LOCK_RE.test('could not lock config file')).toBe(true);
    expect(GIT_LOCK_RE.test('Unable to create .git/index.lock: File exists')).toBe(true);
    expect(GIT_LOCK_RE.test('another git process seems to be running')).toBe(true);
  });

  it('does not match an ordinary failure — those must not be retried', () => {
    expect(GIT_LOCK_RE.test('fatal: invalid reference: origin/nope')).toBe(false);
    expect(GIT_LOCK_RE.test("fatal: a branch named 'mma/x' already exists")).toBe(false);
  });
});
