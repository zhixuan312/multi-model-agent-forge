// @vitest-environment node
import { GitOps } from '@/build/branch';
import { executeTask, type RepoContext, type ExecutorDeps } from '@/build/executor';
import type { ManifestSnapshot } from '@/build/command-inference';
import { createMockDb } from '../test-utils/mock-db';
import {
  RecordingBus,
  FakePlanFs,
  FakeGit,
  makeGitScript,
  FakeCommandRunner,
  FakeMma,
} from './fixtures';

const NODE_MANIFEST: ManifestSnapshot = { kind: 'node', packageJson: { scripts: { build: 'tsc', test: 'vitest' } }, lockfiles: {} };
const NO_CMD_MANIFEST: ManifestSnapshot = { kind: 'node', packageJson: { scripts: {} }, lockfiles: {} };

function createTask(projectId: string, repoId: string, overrides: Partial<{ title: string; status: string; reviewPolicy?: string }> = {}) {
  return {
    id: 'task-1',
    projectId,
    targetRepoId: repoId,
    title: overrides.title ?? 'Task 1: Do it',
    detail: 'do it',
    orderIndex: 0,
    isWrite: true,
    status: (overrides.status ?? 'queued') as 'queued' | 'committed' | 'executing' | 'verifying' | 'fixing' | 'skipped' | 'failed',
    reviewPolicy: (overrides.reviewPolicy ?? 'reviewed') as 'reviewed' | 'none',
    commitSha: null,
    fixNote: null,
    meta: null,
    mmaBatchId: null,
    dependsOn: [],
    approvedBy: [],
    participants: [],
    branch: null,
    targetBranch: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function committedEnvelope(opts: { commitSha?: string; cost?: number } = {}) {
  return {
    task: { taskId: 't1', type: 'execute_plan', status: 'done' },
    output: {
      summary: { commitSha: opts.commitSha ?? 'WORKER01', commitSkipReason: null, unresolved: [] },
      filesChanged: ['a.ts'],
      contextBlockId: null,
    },
    execution: { sessions: { implementer: 's1', reviewer: null }, worktree: { merged: true, branch: 'b' } },
    metrics: { totalCostUsd: opts.cost ?? 0.1 },
    error: null,
  };
}

function buildDeps(db: ReturnType<typeof createMockDb>, over: {
  mma: FakeMma;
  git: FakeGit;
  cmd: FakeCommandRunner;
  fs: FakePlanFs;
  bus: RecordingBus;
  manifest?: ManifestSnapshot;
  inlineFix?: ExecutorDeps['inlineFix'];
}): ExecutorDeps {
  return {
    db,
    mma: over.mma as unknown as ExecutorDeps['mma'],
    git: new GitOps(over.git.runner),
    command: over.cmd,
    fs: over.fs,
    bus: over.bus,
    readManifest: async () => over.manifest ?? NODE_MANIFEST,
    inlineFix: over.inlineFix ?? (async () => ({ note: 'fixed the import' })),
    pollIntervalMs: 1,
  };
}

const REPO_CTX = (id: string, name: string, path: string, firstTask = true): RepoContext => ({
  id,
  name,
  pathOnDisk: path,
  defaultBranch: 'main',
  firstTask,
});

describe('executeTask', () => {
  it('verification PASSES → committed (commit payload + 1-commit SHA match + build/test 0 + non-empty diff)', async () => {
    const task = createTask('proj-1', 'repo-1');
    const db = createMockDb({
      'select:project_plan_task': [task],
      'insert:ops_mma_batch': [{ id: 'mma-batch-1', createdAt: new Date() }],
      'update:project_plan_task': [{ ...task, status: 'committed', commitSha: 'WORKER01', meta: { buildCmd: 'npm run build' } }],
      'insert:ops_action_log': [{ id: 'log-1', projectId: 'proj-1', memberId: 'member-1', action: 'execute', target: 'repo:test-repo', meta: null, createdAt: new Date() }],
    });
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    const cmd = new FakeCommandRunner([{ kind: 'pass' }, { kind: 'pass' }]);
    const bus = new RecordingBus();
    const out = await executeTask(buildDeps(db, { mma, git, cmd, fs: new FakePlanFs(), bus }), {
      task,
      repo: REPO_CTX('repo-1', 'test-repo', '/work/a'),
      projectId: 'proj-1',
      actorId: 'member-1',
    });
    expect(out).toEqual({ status: 'committed', commitSha: 'WORKER01' });
    expect(db._assertCalled('project_plan_task', 'update')).toBe(true);
    expect(bus.ofType('task.committed')).toHaveLength(1);
    // execute-plan dispatch shape.
    expect(mma.dispatches[0].body).toMatchObject({
      planPath: expect.stringContaining('.forge'),
      tasks: ['Task 1: Do it'],
      reviewPolicy: 'reviewed',
    });
  });

  it('no_op commit payload → failure (the falsely-not-implemented trap)', async () => {
    const task = createTask('proj-1', 'repo-1');
    const db = createMockDb({
      'select:project_plan_task': [task],
      'insert:ops_mma_batch': [{ id: 'mma-batch-1', createdAt: new Date() }],
      'update:project_plan_task': [{ ...task, status: 'failed' }],
    });
    const env = {
      task: { status: 'done' },
      output: { summary: { commitSha: null, commitSkipReason: 'no_diff', unresolved: [] }, filesChanged: [] },
      execution: { worktree: { merged: false, branch: 'b' } },
      error: null,
    };
    const mma = new FakeMma({ 'execute-plan': [env] });
    const git = new FakeGit(makeGitScript({}));
    const bus = new RecordingBus();
    const out = await executeTask(buildDeps(db, { mma, git, cmd: new FakeCommandRunner(), fs: new FakePlanFs(), bus }), {
      task,
      repo: REPO_CTX('repo-1', 'test-repo', '/work/b'),
      projectId: 'proj-1',
      actorId: 'member-1',
    });
    expect(out.status).toBe('failed');
    expect(bus.ofType('build.task_failed')).toHaveLength(1);
  });

  it('self-commit detected (SHA mismatch / >1 commit) → failure', async () => {
    const task = createTask('proj-1', 'repo-1');
    const db = createMockDb({
      'select:project_plan_task': [task],
      'insert:ops_mma_batch': [{ id: 'mma-batch-1', createdAt: new Date() }],
      'update:project_plan_task': [{ ...task, status: 'failed' }],
    });
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    // Two commits in head_before..HEAD → suspect self-commit.
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01', 'EXTRA02'] }));
    const out = await executeTask(buildDeps(db, { mma, git, cmd: new FakeCommandRunner([{ kind: 'pass' }, { kind: 'pass' }]), fs: new FakePlanFs(), bus: new RecordingBus() }), {
      task,
      repo: REPO_CTX('repo-1', 'test-repo', '/work/c'),
      projectId: 'proj-1',
      actorId: 'member-1',
    });
    expect(out.status).toBe('failed');
  });

  it('build/test failure → inline fix → re-verify pass → committed (fix SHA in meta, commit_sha still worker)', async () => {
    const task = createTask('proj-1', 'repo-1');
    const db = createMockDb({
      'select:project_plan_task': [task],
      'insert:ops_mma_batch': [{ id: 'mma-batch-1', createdAt: new Date() }],
      'update:project_plan_task': [{ ...task, status: 'committed', commitSha: 'WORKER01', fixNote: 'fixed the import', meta: { fixCommitSha: 'FIXSHA99' } }],
    });
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true, inlineFixSha: 'FIXSHA99' }));
    // build pass, test FAIL, then re-verify build pass + test pass.
    const cmd = new FakeCommandRunner([{ kind: 'pass' }, { kind: 'fail', exitCode: 1, outputTail: 'boom' }, { kind: 'pass' }, { kind: 'pass' }]);
    const bus = new RecordingBus();
    const out = await executeTask(buildDeps(db, { mma, git, cmd, fs: new FakePlanFs(), bus }), {
      task,
      repo: REPO_CTX('repo-1', 'test-repo', '/work/d'),
      projectId: 'proj-1',
      actorId: 'member-1',
    });
    expect(out).toEqual({ status: 'committed', commitSha: 'WORKER01' });
    // SSE order: fixing then fixed.
    const types = bus.events.map((e) => e.event.type);
    expect(types.indexOf('task.fixing')).toBeLessThan(types.indexOf('task.fixed'));
  });

  it('inline-fix cap: still failing after MAX attempts → failed + halt', async () => {
    const task = createTask('proj-1', 'repo-1');
    const db = createMockDb({
      'select:project_plan_task': [task],
      'insert:ops_mma_batch': [{ id: 'mma-batch-1', createdAt: new Date() }],
      'update:project_plan_task': [{ ...task, status: 'failed' }],
    });
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    // initial: build pass, test fail; then every re-verify fails.
    const fails = Array.from({ length: 12 }, () => ({ kind: 'fail', exitCode: 1, outputTail: 'boom' }) as const);
    const cmd = new FakeCommandRunner([{ kind: 'pass' }, ...fails]);
    const out = await executeTask(buildDeps(db, { mma, git, cmd, fs: new FakePlanFs(), bus: new RecordingBus() }), {
      task,
      repo: REPO_CTX('repo-1', 'test-repo', '/work/e'),
      projectId: 'proj-1',
      actorId: 'member-1',
    });
    expect(out.status).toBe('failed');
  });

  it('F16: review_policy=none defers build+test (verifies on commit/diff alone)', async () => {
    const task = createTask('proj-1', 'repo-1', { reviewPolicy: 'none' });
    const db = createMockDb({
      'select:project_plan_task': [task],
      'insert:ops_mma_batch': [{ id: 'mma-batch-1', createdAt: new Date() }],
      'update:project_plan_task': [{ ...task, status: 'committed', commitSha: 'WORKER01' }],
    });
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    // A failing build/test that would normally route to fixing — but none defers it.
    const cmd = new FakeCommandRunner([{ kind: 'fail', exitCode: 1, outputTail: 'expected' }]);
    const bus = new RecordingBus();
    const out = await executeTask(buildDeps(db, { mma, git, cmd, fs: new FakePlanFs(), bus }), {
      task,
      repo: REPO_CTX('repo-1', 'test-repo', '/work/f'),
      projectId: 'proj-1',
      actorId: 'member-1',
    });
    expect(out).toEqual({ status: 'committed', commitSha: 'WORKER01' });
    expect(bus.ofType('task.fixing')).toHaveLength(0);
    // reviewPolicy maps the typed column.
    expect(mma.dispatches[0].body).toMatchObject({ reviewPolicy: 'none' });
  });

  it('F2: absent build+test commands → vacuous pass → committed', async () => {
    const task = createTask('proj-1', 'repo-1');
    const db = createMockDb({
      'select:project_plan_task': [task],
      'insert:ops_mma_batch': [{ id: 'mma-batch-1', createdAt: new Date() }],
      'update:project_plan_task': [{ ...task, status: 'committed', commitSha: 'WORKER01' }],
    });
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    const cmd = new FakeCommandRunner(); // never called (no commands inferred)
    const out = await executeTask(buildDeps(db, { mma, git, cmd, fs: new FakePlanFs(), bus: new RecordingBus(), manifest: NO_CMD_MANIFEST }), {
      task,
      repo: REPO_CTX('repo-1', 'test-repo', '/work/g'),
      projectId: 'proj-1',
      actorId: 'member-1',
    });
    expect(out.status).toBe('committed');
    expect(cmd.calls).toHaveLength(0);
  });

  it('missing toolchain (env_error) → failed with environment reason, not code failure', async () => {
    const task = createTask('proj-1', 'repo-1');
    const db = createMockDb({
      'select:project_plan_task': [task],
      'insert:ops_mma_batch': [{ id: 'mma-batch-1', createdAt: new Date() }],
      'update:project_plan_task': [{ ...task, status: 'failed' }],
    });
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    const cmd = new FakeCommandRunner([{ kind: 'env_error', detail: 'command not found: npm' }]);
    const bus = new RecordingBus();
    const out = await executeTask(buildDeps(db, { mma, git, cmd, fs: new FakePlanFs(), bus }), {
      task,
      repo: REPO_CTX('repo-1', 'test-repo', '/work/h'),
      projectId: 'proj-1',
      actorId: 'member-1',
    });
    expect(out.status).toBe('failed');
    expect((out as { reason: string }).reason).toContain('environment');
  });

  it('halt-on-decision: enumerated halt errorCode → status halt', async () => {
    const task = createTask('proj-1', 'repo-1');
    const db = createMockDb({
      'select:project_plan_task': [task],
      'insert:ops_mma_batch': [{ id: 'mma-batch-1', createdAt: new Date() }],
      'update:project_plan_task': [{ ...task, status: 'halt' }],
    });
    const env = {
      task: { status: 'failed' },
      output: { summary: { commitSha: null, unresolved: [] }, filesChanged: [] },
      execution: { worktree: null },
      error: { code: 'validator_no_changes', message: 'm' },
    };
    const mma = new FakeMma({ 'execute-plan': [env] });
    const git = new FakeGit(makeGitScript({}));
    const out = await executeTask(buildDeps(db, { mma, git, cmd: new FakeCommandRunner(), fs: new FakePlanFs(), bus: new RecordingBus() }), {
      task,
      repo: REPO_CTX('repo-1', 'test-repo', '/work/i'),
      projectId: 'proj-1',
      actorId: 'member-1',
    });
    expect(out.status).toBe('halt');
  });

  it('branch-prep failure (detached HEAD) → failed, execute-plan never dispatched', async () => {
    const task = createTask('proj-1', 'repo-1');
    const db = createMockDb({
      'select:project_plan_task': [task],
      'update:project_plan_task': [{ ...task, status: 'failed' }],
    });
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope()] });
    const git = new FakeGit(makeGitScript({ attached: false }));
    const out = await executeTask(buildDeps(db, { mma, git, cmd: new FakeCommandRunner(), fs: new FakePlanFs(), bus: new RecordingBus() }), {
      task,
      repo: REPO_CTX('repo-1', 'test-repo', '/work/j'),
      projectId: 'proj-1',
      actorId: 'member-1',
    });
    expect(out.status).toBe('failed');
    expect(mma.dispatches).toHaveLength(0);
  });

  it('writes .forge/ to .git/info/exclude on first task (git hygiene F10)', async () => {
    const task = createTask('proj-1', 'repo-1');
    const db = createMockDb({
      'select:project_plan_task': [task],
      'insert:ops_mma_batch': [{ id: 'mma-batch-1', createdAt: new Date() }],
      'update:project_plan_task': [{ ...task, status: 'committed', commitSha: 'WORKER01' }],
    });
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    const fs = new FakePlanFs();
    await executeTask(buildDeps(db, { mma, git, cmd: new FakeCommandRunner([{ kind: 'pass' }, { kind: 'pass' }]), fs, bus: new RecordingBus(), manifest: NODE_MANIFEST }), {
      task,
      repo: REPO_CTX('repo-1', 'test-repo', '/work/k'),
      projectId: 'proj-1',
      actorId: 'member-1',
    });
    const excludePath = '/work/k/.git/info/exclude';
    expect(fs.files.get(excludePath)).toContain('.forge/');
  });
});
