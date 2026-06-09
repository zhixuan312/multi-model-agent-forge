// @vitest-environment node
import { afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { artifact } from '@/db/schema/artifacts';
import { exportRecord, planTask } from '@/db/schema/build';
import { runExecutePipeline } from '@/build/orchestrator';
import { GitOps } from '@/build/branch';
import { downloadStageArtifact, ArtifactNotFoundError } from '@/build/export-download';
import { ProjectAccessError } from '@/projects/projects-core';
import { MmaClient } from '@/mma/client';
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
import { project as projectTable } from '@/db/schema/projects';
import { member } from '@/db/schema/identity';

function committedEnvelope(sha: string) {
  return {
    headline: 'done',
    costSummary: { totalActualCostUSD: 0.05 },
    results: [{ status: 'done', error: null }],
    structuredReport: { commitSha: sha, commitSkipReason: null, filesChanged: [{ path: 'a.ts', summary: 's' }], unresolved: [] },
  };
}

describe('runExecutePipeline', () => {
  afterEach(cleanupBuildFixtures);

  it('schedules tasks, reviews committed repos, and advances phase=done (review never blocks)', async () => {
    const repo = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    await getDb()
      .insert(planTask)
      .values({ projectId, targetRepoId: repo.id, title: 'Task 1', detail: 'd', orderIndex: 0, isWrite: true, status: 'queued' });

    const mma = new FakeMma({
      'execute-plan': [committedEnvelope('WORKER01')],
      review: [{ structuredReport: { findings: [{ severity: 'high', claim: 'advisory' }] } }],
    });
    const git = new FakeGit(makeGitScript({ commitsSince: ['WORKER01'], hasDiff: true }));
    const bus = new RecordingBus();

    const res = await runExecutePipeline(
      {
        db: getDb(),
        bus,
        executor: {
          mma: mma as unknown as MmaClient,
          git: new GitOps(git.runner),
          command: new FakeCommandRunner([{ kind: 'pass' }, { kind: 'pass' }]),
          fs: new FakePlanFs(),
          readManifest: async () => ({ kind: 'node', packageJson: { scripts: { build: 'tsc', test: 'vitest' } }, lockfiles: {} }),
          inlineFix: async () => ({ note: 'n' }),
          pollIntervalMs: 1,
        },
        review: { mma: mma as unknown as MmaClient, pollIntervalMs: 1 },
      },
      { projectId, actorId: ownerId },
    );

    expect(res.scheduler.committed).toHaveLength(1);
    // Review advisory verdict surfaced but pipeline still reaches done.
    expect(res.reviews[0].verdict).toBe('changes_required');
    expect(res.reachedDone).toBe(true);
    const [p] = await getDb().select({ phase: project.phase }).from(project).where(eq(project.id, projectId));
    expect(p.phase).toBe('done');
  });
});

describe('downloadStageArtifact (F8)', () => {
  afterEach(cleanupBuildFixtures);

  it('returns the exact body_md as a md attachment + inserts one export row (synthetic file_path)', async () => {
    const { projectId, ownerId } = await seedProject({});
    await getDb().insert(artifact).values({ projectId, kind: 'plan', bodyMd: '# Plan v3 body', version: 3 });
    const res = await downloadStageArtifact({ projectId, kind: 'plan', actor: { id: ownerId } }, { db: getDb() });
    expect(res.bodyMd).toBe('# Plan v3 body');
    expect(res.fileName).toBe('plan-v3.md');
    const rows = await getDb().select().from(exportRecord).where(eq(exportRecord.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(rows[0].format).toBe('md');
    expect(rows[0].filePath).toBe('plan-v3.md');
  });

  it('rejects a private artifact for an unauthorized member (no export row)', async () => {
    // A PRIVATE project owned by one member; the actor is a non-member stranger.
    const [owner] = await getDb()
      .insert(member)
      .values({ username: '__forge_build_member__priv_' + Date.now(), displayName: 'p' })
      .returning({ id: member.id });
    const [p] = await getDb()
      .insert(projectTable)
      .values({ name: '__forge_build_test__priv_' + Date.now(), visibility: 'private', phase: 'build', ownerId: owner.id })
      .returning({ id: projectTable.id });
    await getDb().insert(artifact).values({ projectId: p.id, kind: 'plan', bodyMd: 'secret', version: 1 });

    const [stranger] = await getDb()
      .insert(member)
      .values({ username: '__forge_build_member__stranger_' + Date.now(), displayName: 's' })
      .returning({ id: member.id });

    await expect(
      downloadStageArtifact({ projectId: p.id, kind: 'plan', actor: { id: stranger.id } }, { db: getDb() }),
    ).rejects.toBeInstanceOf(ProjectAccessError);
    const rows = await getDb().select().from(exportRecord).where(eq(exportRecord.projectId, p.id));
    expect(rows).toHaveLength(0);
  });

  it('throws ArtifactNotFoundError when the stage artifact is absent', async () => {
    const { projectId, ownerId } = await seedProject({});
    await expect(
      downloadStageArtifact({ projectId, kind: 'plan', actor: { id: ownerId } }, { db: getDb() }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});
