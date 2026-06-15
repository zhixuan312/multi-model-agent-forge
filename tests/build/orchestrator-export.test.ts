// @vitest-environment node
import { GitOps } from '@/build/branch';
import { runExecutePipeline } from '@/build/orchestrator';
import { downloadStageArtifact, ArtifactNotFoundError } from '@/build/export-download';
import { ProjectAccessError } from '@/projects/projects-core';
import { createMockDb, seq } from '../test-utils/mock-db';
import {
  RecordingBus,
  FakePlanFs,
  FakeGit,
  makeGitScript,
  FakeCommandRunner,
  FakeMma,
} from './fixtures';

function committedEnvelope(sha: string) {
  return {
    headline: 'done',
    costSummary: { totalActualCostUSD: 0.05 },
    results: [{ status: 'done', error: null }],
    structuredReport: { commitSha: sha, commitSkipReason: null, filesChanged: [{ path: 'a.ts', summary: 's' }], unresolved: [] },
  };
}

describe('runExecutePipeline', () => {
  it('schedules tasks, reviews committed repos, and advances phase=done (review never blocks)', async () => {
    const db = createMockDb({
      'select:plan_task': [{ id: 'task-1', projectId: 'proj-1', targetRepoId: 'repo-1', title: 'Task 1', detail: 'd', orderIndex: 0, isWrite: true, status: 'queued', reviewPolicy: 'full', commitSha: null, fixNote: null, meta: null, createdAt: new Date(), updatedAt: new Date() }],
      'select:project': [{ id: 'proj-1', name: 'test-proj', visibility: 'public', phase: 'build', ownerId: 'member-1', createdAt: new Date(), updatedAt: new Date() }],
      'select:project_repo': [{ id: 'repo-1', projectId: 'proj-1', name: 'test-repo', pathOnDisk: '/work/a', defaultBranch: 'main', createdAt: new Date(), updatedAt: new Date() }],
      'insert:mma_batch': [{ id: 'mma-batch-1', createdAt: new Date() }],
      'update:plan_task': [{ id: 'task-1', projectId: 'proj-1', targetRepoId: 'repo-1', title: 'Task 1', detail: 'd', orderIndex: 0, isWrite: true, status: 'committed', reviewPolicy: 'full', commitSha: 'WORKER01', fixNote: null, meta: null, createdAt: new Date(), updatedAt: new Date() }],
      'update:project': [{ id: 'proj-1', name: 'test-proj', visibility: 'public', phase: 'done', ownerId: 'member-1', createdAt: new Date(), updatedAt: new Date() }],
      'insert:action_log': [{ id: 'log-1', projectId: 'proj-1', memberId: 'member-1', action: 'execute', target: 'repo:test-repo', meta: null, createdAt: new Date() }],
    });
    const mma = new FakeMma({
      'execute-plan': [committedEnvelope('WORKER01')],
      review: [{ structuredReport: { findings: [{ severity: 'high', claim: 'advisory' }] } }],
    });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    const bus = new RecordingBus();

    const res = await runExecutePipeline(
      {
        db,
        bus,
        executor: {
          mma: mma as unknown as any,
          git: new GitOps(git.runner),
          command: new FakeCommandRunner([{ kind: 'pass' }, { kind: 'pass' }]),
          fs: new FakePlanFs(),
          readManifest: async () => ({ kind: 'node', packageJson: { scripts: { build: 'tsc', test: 'vitest' } }, lockfiles: {} }),
          inlineFix: async () => ({ note: 'n' }),
          pollIntervalMs: 1,
        },
        review: { mma: mma as unknown as any, pollIntervalMs: 1 },
      },
      { projectId: 'proj-1', actorId: 'member-1' },
    );

    expect(res.scheduler.committed).toHaveLength(1);
    // Review advisory verdict surfaced but pipeline still reaches done.
    expect(res.reviews[0].verdict).toBe('changes_required');
    expect(res.reachedDone).toBe(true);
    expect(db._assertCalled('project', 'update')).toBe(true);
  });
});

describe('downloadStageArtifact (F8)', () => {
  it('returns the exact body_md as a md attachment + inserts one export row (synthetic file_path)', async () => {
    const db = createMockDb({
      'select:project': [{ id: 'proj-1', name: 'test-proj', visibility: 'public', phase: 'build', ownerId: 'member-1', createdAt: new Date(), updatedAt: new Date() }],
      'select:artifact': [{ id: 'art-1', projectId: 'proj-1', kind: 'plan', bodyMd: '# Plan v3 body', version: 3, createdAt: new Date(), updatedAt: new Date() }],
      'insert:export': [{ id: 'exp-1', projectId: 'proj-1', format: 'md', filePath: 'plan-v3.md', createdAt: new Date() }],
      'select:export_record': [{ id: 'exp-1', projectId: 'proj-1', format: 'md', filePath: 'plan-v3.md', createdAt: new Date() }],
    });
    const res = await downloadStageArtifact({ projectId: 'proj-1', kind: 'plan', actor: { id: 'member-1' } }, { db });
    expect(res.bodyMd).toBe('# Plan v3 body');
    expect(res.fileName).toBe('plan-v3.md');
    expect(db._assertCalled('export', 'insert')).toBe(true);
  });

  it('rejects a private artifact for an unauthorized member (no export row)', async () => {
    const db = createMockDb({
      'select:project': [{ id: 'proj-1', name: 'test-proj', visibility: 'private', phase: 'build', ownerId: 'member-2', createdAt: new Date(), updatedAt: new Date() }],
      'select:artifact': [{ id: 'art-1', projectId: 'proj-1', kind: 'plan', bodyMd: 'secret', version: 1, createdAt: new Date(), updatedAt: new Date() }],
    });
    await expect(
      downloadStageArtifact({ projectId: 'proj-1', kind: 'plan', actor: { id: 'member-1' } }, { db }),
    ).rejects.toBeInstanceOf(ProjectAccessError);
  });

  it('throws ArtifactNotFoundError when the stage artifact is absent', async () => {
    const db = createMockDb({
      'select:project': [{ id: 'proj-1', name: 'test-proj', visibility: 'public', phase: 'build', ownerId: 'member-1', createdAt: new Date(), updatedAt: new Date() }],
      'select:artifact': [],
    });
    await expect(
      downloadStageArtifact({ projectId: 'proj-1', kind: 'plan', actor: { id: 'member-1' } }, { db }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});
