// @vitest-environment node
import { afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { planTask, type PlanTaskRow } from '@/db/schema/build';
import { GitOps } from '@/build/branch';
import { executeTask, type RepoContext, type ExecutorDeps } from '@/build/executor';
import type { ManifestSnapshot } from '@/build/command-inference';
import {
  seedProject,
  seedRepo,
  cleanupBuildFixtures,
  RecordingBus,
  FakePlanFs,
  FakeGit,
  makeGitScript,
  FakeCommandRunner,
  FakeMma,
} from './fixtures';

const NODE_MANIFEST: ManifestSnapshot = { kind: 'node', packageJson: { scripts: { build: 'tsc', test: 'vitest' } }, lockfiles: {} };
const NO_CMD_MANIFEST: ManifestSnapshot = { kind: 'node', packageJson: { scripts: {} }, lockfiles: {} };

async function seedTask(projectId: string, repoId: string, overrides: Partial<PlanTaskRow> = {}): Promise<PlanTaskRow> {
  const [row] = await getDb()
    .insert(planTask)
    .values({ projectId, targetRepoId: repoId, title: 'Task 1: Do it', detail: 'do it', orderIndex: 0, isWrite: true, status: 'queued', ...overrides })
    .returning();
  return row;
}

function committedEnvelope(opts: { commitSha?: string; cost?: number } = {}) {
  return {
    headline: 'execute_plan: 1 task complete',
    costSummary: { totalActualCostUSD: opts.cost ?? 0.1 },
    results: [{ status: 'done', error: null }],
    structuredReport: { commitSha: opts.commitSha ?? 'WORKER01', commitSkipReason: null, filesChanged: [{ path: 'a.ts', summary: 's' }], unresolved: [] },
  };
}

function buildDeps(over: {
  mma: FakeMma;
  git: FakeGit;
  cmd: FakeCommandRunner;
  fs: FakePlanFs;
  bus: RecordingBus;
  manifest?: ManifestSnapshot;
  inlineFix?: ExecutorDeps['inlineFix'];
}): ExecutorDeps {
  return {
    db: getDb(),
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
  kind: 'node',
  defaultBranch: 'main',
  firstTask,
});

describe('executeTask', () => {
  afterEach(cleanupBuildFixtures);

  it('verification PASSES → committed (commit payload + 1-commit SHA match + build/test 0 + non-empty diff)', async () => {
    const repo = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const task = await seedTask(projectId, repo.id);
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    const cmd = new FakeCommandRunner([{ kind: 'pass' }, { kind: 'pass' }]);
    const bus = new RecordingBus();
    const out = await executeTask(buildDeps({ mma, git, cmd, fs: new FakePlanFs(), bus }), {
      task,
      repo: REPO_CTX(repo.id, repo.name, repo.pathOnDisk),
      projectId,
      actorId: ownerId,
    });
    expect(out).toEqual({ status: 'committed', commitSha: 'WORKER01' });
    const [row] = await getDb().select().from(planTask).where(eq(planTask.id, task.id));
    expect(row.status).toBe('committed');
    expect(row.commitSha).toBe('WORKER01');
    expect((row.meta as { buildCmd?: string }).buildCmd).toBe('npm run build');
    expect(bus.ofType('task.committed')).toHaveLength(1);
    // execute-plan dispatch shape.
    expect(mma.dispatches[0].body).toMatchObject({
      filePaths: [expect.stringContaining('.forge')],
      taskDescriptors: ['Task 1: Do it'],
      perTaskReviewPolicy: { '0': 'full' },
    });
  });

  it('no_op commit payload → failure (the falsely-not-implemented trap)', async () => {
    const repo = await seedRepo('b', '/work/b');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const task = await seedTask(projectId, repo.id);
    const env = { structuredReport: { commitSha: null, commitSkipReason: 'no_diff', filesChanged: [], unresolved: [] } };
    const mma = new FakeMma({ 'execute-plan': [env] });
    const git = new FakeGit(makeGitScript({}));
    const bus = new RecordingBus();
    const out = await executeTask(buildDeps({ mma, git, cmd: new FakeCommandRunner(), fs: new FakePlanFs(), bus }), {
      task,
      repo: REPO_CTX(repo.id, repo.name, repo.pathOnDisk),
      projectId,
      actorId: ownerId,
    });
    expect(out.status).toBe('failed');
    expect(bus.ofType('build.task_failed')).toHaveLength(1);
  });

  it('self-commit detected (SHA mismatch / >1 commit) → failure', async () => {
    const repo = await seedRepo('c', '/work/c');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const task = await seedTask(projectId, repo.id);
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    // Two commits in head_before..HEAD → suspect self-commit.
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01', 'EXTRA02'] }));
    const out = await executeTask(buildDeps({ mma, git, cmd: new FakeCommandRunner([{ kind: 'pass' }, { kind: 'pass' }]), fs: new FakePlanFs(), bus: new RecordingBus() }), {
      task,
      repo: REPO_CTX(repo.id, repo.name, repo.pathOnDisk),
      projectId,
      actorId: ownerId,
    });
    expect(out.status).toBe('failed');
  });

  it('build/test failure → inline fix → re-verify pass → committed (fix SHA in meta, commit_sha still worker)', async () => {
    const repo = await seedRepo('d', '/work/d');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const task = await seedTask(projectId, repo.id);
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true, inlineFixSha: 'FIXSHA99' }));
    // build pass, test FAIL, then re-verify build pass + test pass.
    const cmd = new FakeCommandRunner([{ kind: 'pass' }, { kind: 'fail', exitCode: 1, outputTail: 'boom' }, { kind: 'pass' }, { kind: 'pass' }]);
    const bus = new RecordingBus();
    const out = await executeTask(buildDeps({ mma, git, cmd, fs: new FakePlanFs(), bus }), {
      task,
      repo: REPO_CTX(repo.id, repo.name, repo.pathOnDisk),
      projectId,
      actorId: ownerId,
    });
    expect(out).toEqual({ status: 'committed', commitSha: 'WORKER01' });
    const [row] = await getDb().select().from(planTask).where(eq(planTask.id, task.id));
    expect(row.commitSha).toBe('WORKER01'); // NOT the fix sha
    expect((row.meta as { fixCommitSha?: string }).fixCommitSha).toBe('FIXSHA99');
    expect(row.fixNote).toBe('fixed the import');
    // SSE order: fixing then fixed.
    const types = bus.events.map((e) => e.event.type);
    expect(types.indexOf('task.fixing')).toBeLessThan(types.indexOf('task.fixed'));
  });

  it('inline-fix cap: still failing after MAX attempts → failed + halt', async () => {
    const repo = await seedRepo('e', '/work/e');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const task = await seedTask(projectId, repo.id);
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    // initial: build pass, test fail; then every re-verify fails.
    const fails = Array.from({ length: 12 }, () => ({ kind: 'fail', exitCode: 1, outputTail: 'boom' }) as const);
    const cmd = new FakeCommandRunner([{ kind: 'pass' }, ...fails]);
    const out = await executeTask(buildDeps({ mma, git, cmd, fs: new FakePlanFs(), bus: new RecordingBus() }), {
      task,
      repo: REPO_CTX(repo.id, repo.name, repo.pathOnDisk),
      projectId,
      actorId: ownerId,
    });
    expect(out.status).toBe('failed');
  });

  it('F16: review_policy=none defers build+test (verifies on commit/diff alone)', async () => {
    const repo = await seedRepo('f', '/work/f');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const task = await seedTask(projectId, repo.id, { reviewPolicy: 'none' });
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    // A failing build/test that would normally route to fixing — but none defers it.
    const cmd = new FakeCommandRunner([{ kind: 'fail', exitCode: 1, outputTail: 'expected' }]);
    const bus = new RecordingBus();
    const out = await executeTask(buildDeps({ mma, git, cmd, fs: new FakePlanFs(), bus }), {
      task,
      repo: REPO_CTX(repo.id, repo.name, repo.pathOnDisk),
      projectId,
      actorId: ownerId,
    });
    expect(out).toEqual({ status: 'committed', commitSha: 'WORKER01' });
    expect(bus.ofType('task.fixing')).toHaveLength(0);
    // perTaskReviewPolicy maps the typed column.
    expect(mma.dispatches[0].body).toMatchObject({ perTaskReviewPolicy: { '0': 'none' } });
  });

  it('F2: absent build+test commands → vacuous pass → committed', async () => {
    const repo = await seedRepo('g', '/work/g');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const task = await seedTask(projectId, repo.id);
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    const cmd = new FakeCommandRunner(); // never called (no commands inferred)
    const out = await executeTask(buildDeps({ mma, git, cmd, fs: new FakePlanFs(), bus: new RecordingBus(), manifest: NO_CMD_MANIFEST }), {
      task,
      repo: REPO_CTX(repo.id, repo.name, repo.pathOnDisk),
      projectId,
      actorId: ownerId,
    });
    expect(out.status).toBe('committed');
    expect(cmd.calls).toHaveLength(0);
  });

  it('missing toolchain (env_error) → failed with environment reason, not code failure', async () => {
    const repo = await seedRepo('h', '/work/h');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const task = await seedTask(projectId, repo.id);
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    const cmd = new FakeCommandRunner([{ kind: 'env_error', detail: 'command not found: npm' }]);
    const bus = new RecordingBus();
    const out = await executeTask(buildDeps({ mma, git, cmd, fs: new FakePlanFs(), bus }), {
      task,
      repo: REPO_CTX(repo.id, repo.name, repo.pathOnDisk),
      projectId,
      actorId: ownerId,
    });
    expect(out.status).toBe('failed');
    expect((out as { reason: string }).reason).toContain('environment');
  });

  it('halt-on-decision: enumerated halt errorCode → status halt', async () => {
    const repo = await seedRepo('i', '/work/i');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const task = await seedTask(projectId, repo.id);
    const env = { results: [{ error: { code: 'validator_no_changes' } }], structuredReport: { commitSha: null, filesChanged: [], unresolved: [] } };
    const mma = new FakeMma({ 'execute-plan': [env] });
    const git = new FakeGit(makeGitScript({}));
    const out = await executeTask(buildDeps({ mma, git, cmd: new FakeCommandRunner(), fs: new FakePlanFs(), bus: new RecordingBus() }), {
      task,
      repo: REPO_CTX(repo.id, repo.name, repo.pathOnDisk),
      projectId,
      actorId: ownerId,
    });
    expect(out.status).toBe('halt');
  });

  it('branch-prep failure (detached HEAD) → failed, execute-plan never dispatched', async () => {
    const repo = await seedRepo('j', '/work/j');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const task = await seedTask(projectId, repo.id);
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope()] });
    const git = new FakeGit(makeGitScript({ attached: false }));
    const out = await executeTask(buildDeps({ mma, git, cmd: new FakeCommandRunner(), fs: new FakePlanFs(), bus: new RecordingBus() }), {
      task,
      repo: REPO_CTX(repo.id, repo.name, repo.pathOnDisk),
      projectId,
      actorId: ownerId,
    });
    expect(out.status).toBe('failed');
    expect(mma.dispatches).toHaveLength(0);
  });

  it('writes .forge/ to .git/info/exclude on first task (git hygiene F10)', async () => {
    const repo = await seedRepo('k', '/work/k');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const task = await seedTask(projectId, repo.id);
    const mma = new FakeMma({ 'execute-plan': [committedEnvelope({ commitSha: 'WORKER01' })] });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    const fs = new FakePlanFs();
    await executeTask(buildDeps({ mma, git, cmd: new FakeCommandRunner([{ kind: 'pass' }, { kind: 'pass' }]), fs, bus: new RecordingBus(), manifest: NODE_MANIFEST }), {
      task,
      repo: REPO_CTX(repo.id, repo.name, repo.pathOnDisk),
      projectId,
      actorId: ownerId,
    });
    const excludePath = '/work/k/.git/info/exclude';
    expect(fs.files.get(excludePath)).toContain('.forge/');
  });
});
