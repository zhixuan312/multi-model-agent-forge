// @vitest-environment node
import { vi } from 'vitest';
import {
  authorizeExecute,
  hasExecuteAuthorization,
  isExecuteLocked,
  ExecuteLockedError,
} from '@/build/execute-authz';
import { reviewRepo } from '@/build/review';
import { createMockDb, seq } from '../test-utils/mock-db';
import { RecordingBus, FakeMma } from './fixtures';

describe('execute authorization (F10)', () => {
  it('authorize writes ops_action_log(action=execute, target=repo:<name>) + emits execute.notice + holds lock', async () => {
    const db = createMockDb({
      'select:ops_action_log': seq(
        [],
        [{ id: 'log-1', projectId: 'proj-1', memberId: 'member-1', action: 'execute', target: 'repo:test-repo', meta: null, createdAt: new Date() }],
      ),
      'insert:ops_action_log': [{ id: 'log-1', projectId: 'proj-1', memberId: 'member-1', action: 'execute', target: 'repo:test-repo', meta: null, createdAt: new Date() }],
    });
    const bus = new RecordingBus();
    expect(await hasExecuteAuthorization(db, 'proj-1', 'test-repo')).toBe(false);

    const release = await authorizeExecute(
      { projectId: 'proj-1', repoId: 'repo-1', repoName: 'test-repo', memberId: 'member-1' },
      { db, bus },
    );
    expect(isExecuteLocked('proj-1', 'repo-1')).toBe(true);

    expect(db._assertCalled('ops_action_log', 'insert')).toBe(true);
    const notice = bus.ofType('execute.notice')[0];
    expect(notice.memberId).toBe('member-1');
    expect(notice.repo).toBe('test-repo');

    expect(await hasExecuteAuthorization(db, 'proj-1', 'test-repo')).toBe(true);
    release();
    expect(isExecuteLocked('proj-1', 'repo-1')).toBe(false);
  });

  it('a second concurrent executor on the same repo is blocked (advisory lock)', async () => {
    const db = createMockDb({
      'select:ops_action_log': [],
      'insert:ops_action_log': [{ id: 'log-1', projectId: 'proj-1', memberId: 'member-1', action: 'execute', target: 'repo:test-repo', meta: null, createdAt: new Date() }],
    });
    const release = await authorizeExecute(
      { projectId: 'proj-1', repoId: 'repo-1', repoName: 'test-repo', memberId: 'member-1' },
      { db, bus: new RecordingBus() },
    );
    await expect(
      authorizeExecute({ projectId: 'proj-1', repoId: 'repo-1', repoName: 'test-repo', memberId: 'member-1' }, { db, bus: new RecordingBus() }),
    ).rejects.toBeInstanceOf(ExecuteLockedError);
    release();
  });
});

describe('reviewRepo verdict derivation (F4)', () => {
  it('changes_required iff ≥1 critical/high; emits review.done', async () => {
    const bus = new RecordingBus();
    const mma = new FakeMma({ review: [{ task: { status: 'done' }, output: { summary: { findings: [{ severity: 'critical', claim: 'sqli' }, { severity: 'low', claim: 'nit' }] } }, error: null }] });
    const res = await reviewRepo(
      { mma: mma as unknown as any, bus, pollIntervalMs: 1 },
      { projectId: 'p1', repoName: 'svc', repoCwd: '/work/svc', changedFiles: ['a.ts'] },
    );
    expect(res.verdict).toBe('changes_required');
    expect(res.findingsCount).toBe(2);
    expect(bus.ofType('review.done')[0].verdict).toBe('changes_required');
  });

  it('approved for only medium/low; advisory error on a failed batch', async () => {
    const mma = new FakeMma({ review: [{ task: { status: 'done' }, output: { summary: { findings: [{ severity: 'medium', claim: 'x' }] } }, error: null }] });
    const approved = await reviewRepo(
      { mma: mma as unknown as any, bus: new RecordingBus(), pollIntervalMs: 1 },
      { projectId: 'p1', repoName: 'svc', repoCwd: '/work/svc', changedFiles: [] },
    );
    expect(approved.verdict).toBe('approved');

    const failing = new FakeMma({});
    failing.failDispatch = true;
    const errored = await reviewRepo(
      { mma: failing as unknown as any, bus: new RecordingBus(), pollIntervalMs: 1 },
      { projectId: 'p1', repoName: 'svc', repoCwd: '/work/svc', changedFiles: [] },
    );
    expect(errored.verdict).toBe('error'); // advisory — never throws
  });
});
