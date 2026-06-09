// @vitest-environment node
import { afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { actionLog } from '@/db/schema/audit';
import {
  authorizeExecute,
  hasExecuteAuthorization,
  isExecuteLocked,
  ExecuteLockedError,
} from '@/build/execute-authz';
import { reviewRepo } from '@/build/review';
import { MmaClient } from '@/mma/client';
import { seedProject, seedRepo, cleanupBuildFixtures, RecordingBus, FakeMma } from './fixtures';

describe('execute authorization (F10)', () => {
  afterEach(cleanupBuildFixtures);

  it('authorize writes action_log(action=execute, target=repo:<name>) + emits execute.notice + holds lock', async () => {
    const repo = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const bus = new RecordingBus();
    expect(await hasExecuteAuthorization(getDb(), projectId, repo.name)).toBe(false);

    const release = await authorizeExecute(
      { projectId, repoId: repo.id, repoName: repo.name, memberId: ownerId },
      { db: getDb(), bus },
    );
    expect(isExecuteLocked(projectId, repo.id)).toBe(true);

    const [row] = await getDb()
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.projectId, projectId), eq(actionLog.action, 'execute')));
    expect(row.target).toBe(`repo:${repo.name}`);
    expect(row.memberId).toBe(ownerId);

    const notice = bus.ofType('execute.notice')[0];
    expect(notice.memberId).toBe(ownerId);
    expect(notice.repo).toBe(repo.name);

    expect(await hasExecuteAuthorization(getDb(), projectId, repo.name)).toBe(true);
    release();
    expect(isExecuteLocked(projectId, repo.id)).toBe(false);
  });

  it('a second concurrent executor on the same repo is blocked (advisory lock)', async () => {
    const repo = await seedRepo('b', '/work/b');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const release = await authorizeExecute(
      { projectId, repoId: repo.id, repoName: repo.name, memberId: ownerId },
      { db: getDb(), bus: new RecordingBus() },
    );
    await expect(
      authorizeExecute({ projectId, repoId: repo.id, repoName: repo.name, memberId: ownerId }, { db: getDb(), bus: new RecordingBus() }),
    ).rejects.toBeInstanceOf(ExecuteLockedError);
    release();
  });
});

describe('reviewRepo verdict derivation (F4)', () => {
  it('changes_required iff ≥1 critical/high; emits review.done', async () => {
    const bus = new RecordingBus();
    const mma = new FakeMma({ review: [{ structuredReport: { findings: [{ severity: 'critical', claim: 'sqli' }, { severity: 'low', claim: 'nit' }] } }] });
    const res = await reviewRepo(
      { mma: mma as unknown as MmaClient, bus, pollIntervalMs: 1 },
      { projectId: 'p1', repoName: 'svc', repoCwd: '/work/svc', changedFiles: ['a.ts'] },
    );
    expect(res.verdict).toBe('changes_required');
    expect(res.findingsCount).toBe(2);
    expect(bus.ofType('review.done')[0].verdict).toBe('changes_required');
  });

  it('approved for only medium/low; advisory error on a failed batch', async () => {
    const mma = new FakeMma({ review: [{ structuredReport: { findings: [{ severity: 'medium', claim: 'x' }] } }] });
    const approved = await reviewRepo(
      { mma: mma as unknown as MmaClient, bus: new RecordingBus(), pollIntervalMs: 1 },
      { projectId: 'p1', repoName: 'svc', repoCwd: '/work/svc', changedFiles: [] },
    );
    expect(approved.verdict).toBe('approved');

    const failing = new FakeMma({});
    failing.failDispatch = true;
    const errored = await reviewRepo(
      { mma: failing as unknown as MmaClient, bus: new RecordingBus(), pollIntervalMs: 1 },
      { projectId: 'p1', repoName: 'svc', repoCwd: '/work/svc', changedFiles: [] },
    );
    expect(errored.verdict).toBe('error'); // advisory — never throws
  });
});
