// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({ mkdirSync: vi.fn() }));

import { projectWorktreePath, ensureProjectWorktree, removeProjectWorktree } from '@/build/project-worktree';
import type { GitRunResult } from '@/build/branch';

const REPO = '/ws/demo';
const PROJECT = 'p1';
const BRANCH = 'mma/2026-07-31-proj';
const WT = '/ws/.forge-project-worktrees/p1-demo';

/**
 * Injected git: every invocation is recorded, and `replies` maps a command prefix to the
 * result. Anything unlisted succeeds with empty output.
 */
function fakeGit(replies: Record<string, Partial<GitRunResult>> = {}) {
  const calls: Array<{ cwd: string; argv: string[] }> = [];
  const run = async (cwd: string, argv: string[]): Promise<GitRunResult> => {
    calls.push({ cwd, argv });
    const key = Object.keys(replies).find((k) => argv.join(' ').startsWith(k));
    return { code: 0, stdout: '', stderr: '', ...(key ? replies[key] : {}) };
  };
  return { run, calls, ran: (prefix: string) => calls.filter((c) => c.argv.join(' ').startsWith(prefix)) };
}

describe('projectWorktreePath', () => {
  it('is derived from (repo path, project id) so every stage resolves the same dir', () => {
    // Derived, not stored — execute, review, fix-apply and PR each recompute it with no
    // shared state to thread through details or batch meta.
    expect(projectWorktreePath(REPO, PROJECT)).toBe(WT);
    expect(projectWorktreePath(REPO, PROJECT)).toBe(projectWorktreePath(REPO, PROJECT));
  });

  it('gives two projects on the SAME repo different checkouts', () => {
    expect(projectWorktreePath(REPO, 'a')).not.toBe(projectWorktreePath(REPO, 'b'));
  });

  it('gives one project different checkouts per repo', () => {
    expect(projectWorktreePath('/ws/demo', PROJECT)).not.toBe(projectWorktreePath('/ws/other', PROJECT));
  });
});

describe('ensureProjectWorktree', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates branch + worktree off the fresh remote base on first execute', async () => {
    // No branch yet anywhere.
    const g = fakeGit({ 'branch --show-current': { code: 1 }, 'rev-parse --verify --quiet refs/heads': { code: 1 } });
    const path = await ensureProjectWorktree({ repoPathOnDisk: REPO, projectId: PROJECT, branch: BRANCH, targetBranch: 'main', run: g.run });
    expect(path).toBe(WT);
    expect(g.ran('fetch origin main')).toHaveLength(1);
    expect(g.ran(`worktree add -b ${BRANCH} ${WT} origin/main`)).toHaveLength(1);
  });

  it('is idempotent — an existing checkout on the right branch is reused, no git mutation', async () => {
    // The common case: every retry, and every stage after execute.
    const g = fakeGit({ 'branch --show-current': { code: 0, stdout: `${BRANCH}\n` } });
    const path = await ensureProjectWorktree({ repoPathOnDisk: REPO, projectId: PROJECT, branch: BRANCH, targetBranch: 'main', run: g.run });
    expect(path).toBe(WT);
    expect(g.ran('worktree add')).toHaveLength(0);
    expect(g.ran('checkout')).toHaveLength(0);
  });

  it('REUSES an existing branch rather than recreating it — the work on it must survive', async () => {
    const g = fakeGit({
      'branch --show-current': { code: 1 },                              // no worktree yet
      'rev-parse --verify --quiet refs/heads': { code: 0 },              // but the branch exists
    });
    await ensureProjectWorktree({ repoPathOnDisk: REPO, projectId: PROJECT, branch: BRANCH, targetBranch: 'main', run: g.run });
    // No `-b`: re-creating would either fail or, via the loops helper's `branch -D` retry,
    // destroy a branch already carrying committed work.
    expect(g.ran(`worktree add ${WT} ${BRANCH}`)).toHaveLength(1);
    expect(g.ran(`worktree add -b`)).toHaveLength(0);
    expect(g.calls.some((c) => c.argv.includes('-D'))).toBe(false);
  });

  it('detaches the shared clone when it still holds the branch (pre-worktree projects)', async () => {
    // A branch lives in ONE worktree. Projects branched before this change left the branch
    // checked out in the clone, which would make `worktree add` fail "already checked out".
    let showCurrent = 0;
    const run = async (cwd: string, argv: string[]): Promise<GitRunResult> => {
      const cmd = argv.join(' ');
      if (cmd === 'branch --show-current') {
        showCurrent += 1;
        // 1st call = the worktree (absent); 2nd = the clone, still on our branch.
        return { code: showCurrent === 1 ? 1 : 0, stdout: showCurrent === 1 ? '' : `${BRANCH}\n`, stderr: '' };
      }
      if (cmd.startsWith('rev-parse --verify --quiet refs/heads')) return { code: 0, stdout: '', stderr: '' };
      calls.push(cmd);
      return { code: 0, stdout: '', stderr: '' };
    };
    const calls: string[] = [];
    await ensureProjectWorktree({ repoPathOnDisk: REPO, projectId: PROJECT, branch: BRANCH, targetBranch: 'main', run });
    expect(calls).toContain('checkout --detach');
    expect(calls).toContain(`worktree add ${WT} ${BRANCH}`);
  });

  it('throws on a real worktree-add failure instead of returning an unusable path', async () => {
    const g = fakeGit({
      'branch --show-current': { code: 1 },
      'rev-parse --verify --quiet refs/heads': { code: 1 },
      'worktree add': { code: 128, stderr: 'fatal: invalid reference' },
    });
    await expect(
      ensureProjectWorktree({ repoPathOnDisk: REPO, projectId: PROJECT, branch: BRANCH, targetBranch: 'main', run: g.run }),
    ).rejects.toThrow(/invalid reference/);
  });
});

describe('removeProjectWorktree', () => {
  it('removes the checkout but never the branch — work and any open PR survive', async () => {
    const g = fakeGit();
    await removeProjectWorktree({ repoPathOnDisk: REPO, projectId: PROJECT, run: g.run });
    expect(g.ran(`worktree remove --force ${WT}`)).toHaveLength(1);
    expect(g.calls.some((c) => c.argv[0] === 'branch')).toBe(false);
  });
});
