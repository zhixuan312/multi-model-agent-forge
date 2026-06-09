// @vitest-environment node
import { GitOps, GitOpsError } from '@/build/branch';
import { FakeGit, makeGitScript } from './fixtures';

const PROJECT = 'abcd1234-0000-0000-0000-000000000001';

describe('GitOps.prepareBranch', () => {
  it('first task: checkout default then checkout -b forge/<id>/<repo>', async () => {
    const git = new FakeGit(makeGitScript({ branchExists: false }));
    const ops = new GitOps(git.runner);
    const { branch, headBefore } = await ops.prepareBranch({
      repoPath: '/work/r',
      projectId: PROJECT,
      repoName: 'svc',
      defaultBranch: 'main',
      firstTask: true,
    });
    expect(branch).toBe('forge/abcd1234/svc');
    expect(headBefore).toBe('BASE000');
    const seq = git.argvStrings();
    expect(seq).toContain('checkout main');
    expect(seq).toContain('checkout -b forge/abcd1234/svc');
  });

  it('subsequent task: no new branch, asserts current branch', async () => {
    const git = new FakeGit(makeGitScript({ currentBranch: 'forge/abcd1234/svc' }));
    const ops = new GitOps(git.runner);
    await ops.prepareBranch({ repoPath: '/work/r', projectId: PROJECT, repoName: 'svc', defaultBranch: 'main', firstTask: false });
    expect(git.argvStrings().filter((s) => s.startsWith('checkout -b'))).toHaveLength(0);
  });

  it('resumed run (branch exists): checkout, not -b', async () => {
    const git = new FakeGit(makeGitScript({ branchExists: true }));
    const ops = new GitOps(git.runner);
    await ops.prepareBranch({ repoPath: '/work/r', projectId: PROJECT, repoName: 'svc', defaultBranch: 'main', firstTask: true });
    const seq = git.argvStrings();
    expect(seq).toContain('checkout forge/abcd1234/svc');
    expect(seq.filter((s) => s.startsWith('checkout -b'))).toHaveLength(0);
  });

  it('detached HEAD → halt, no checkout -b', async () => {
    const git = new FakeGit(makeGitScript({ attached: false }));
    const ops = new GitOps(git.runner);
    await expect(
      ops.prepareBranch({ repoPath: '/work/r', projectId: PROJECT, repoName: 'svc', defaultBranch: 'main', firstTask: true }),
    ).rejects.toMatchObject({ reason: 'detached_head' });
    expect(git.argvStrings().some((s) => s.startsWith('checkout -b'))).toBe(false);
  });

  it('dirty tree → halt', async () => {
    const git = new FakeGit(makeGitScript({ clean: false }));
    const ops = new GitOps(git.runner);
    await expect(
      ops.prepareBranch({ repoPath: '/work/r', projectId: PROJECT, repoName: 'svc', defaultBranch: 'main', firstTask: true }),
    ).rejects.toMatchObject({ reason: 'dirty_tree' });
  });

  it('not cloned → halt, no checkout', async () => {
    const git = new FakeGit(makeGitScript({ isWorkTree: false }));
    const ops = new GitOps(git.runner);
    await expect(
      ops.prepareBranch({ repoPath: '/work/r', projectId: PROJECT, repoName: 'svc', defaultBranch: 'main', firstTask: true }),
    ).rejects.toMatchObject({ reason: 'not_cloned' });
    expect(git.argvStrings().some((s) => s.startsWith('checkout'))).toBe(false);
  });

  it('default branch not a local ref → halt', async () => {
    const git = new FakeGit(makeGitScript({ branchExists: false, defaultBranchExists: false }));
    const ops = new GitOps(git.runner);
    await expect(
      ops.prepareBranch({ repoPath: '/work/r', projectId: PROJECT, repoName: 'svc', defaultBranch: 'main', firstTask: true }),
    ).rejects.toMatchObject({ reason: 'default_branch_missing' });
  });

  it('invalid ref name → halt (check-ref-format runs first)', async () => {
    const git = new FakeGit((argv) => {
      if (argv[0] === 'check-ref-format') return { code: 1, stdout: '', stderr: 'bad ref' };
      return { code: 0, stdout: '', stderr: '' };
    });
    const ops = new GitOps(git.runner);
    await expect(
      ops.prepareBranch({ repoPath: '/work/r', projectId: PROJECT, repoName: 'svc', defaultBranch: 'main', firstTask: true }),
    ).rejects.toMatchObject({ reason: 'invalid_ref_name' });
    expect(git.argvStrings().some((s) => s.startsWith('checkout'))).toBe(false);
  });

  it('commitsSince + hasDiffSince read the git log/diff', async () => {
    const git = new FakeGit(makeGitScript({ commitsSince: ['C1', 'C2'], hasDiff: true }));
    const ops = new GitOps(git.runner);
    expect(await ops.commitsSince('/work/r', 'BASE')).toEqual(['C1', 'C2']);
    expect(await ops.hasDiffSince('/work/r', 'BASE')).toBe(true);
  });

  it('exposes a typed GitOpsError', () => {
    const e = new GitOpsError('dirty_tree', 'x');
    expect(e.reason).toBe('dirty_tree');
  });
});
