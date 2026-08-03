// @vitest-environment node
import { vi } from 'vitest';

// R4: dispatchTasks fans out discover tasks through the CENTRALIZED dispatchMma
// path (async, handler:null + taskId). We mock dispatchMma to assert the contract
// dispatchTasks hands it, plus the task-link flip it does on success.

const { dispatchMma, updateDetails, recordActivity } = vi.hoisted(() => ({
  dispatchMma: vi.fn(async (_opts: Record<string, unknown>) => ({ batchRowId: 'row-1', batchId: 'ext-1' })),
  updateDetails: vi.fn(async (_db: unknown, _pid: string, fn: (d: unknown) => unknown) => fn),
  recordActivity: vi.fn(async (_input: { kind: string; label: string; eventKey?: string | null }) => {}),
}));

vi.mock('@/dispatch/dispatch-helpers', () => ({ dispatchMma }));
vi.mock('@/details/write', () => ({ updateDetails }));
vi.mock('@/activity/project-activity', () => ({ recordActivity }));
vi.mock('@/observability/poll-log', () => ({ logPoll: vi.fn() }));
vi.mock('@/git/workspace-root', () => ({ resolveWorkspaceRoot: () => '/ws' }));

import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

const { dispatchTasks } = await import('@/exploration/dispatch');

function detailsWith(tasks: Array<{ kind: string; prompt: string; repoId?: string; status?: string }>) {
  const d = buildInitialDetails();
  d.stages.exploration.phases.discover.tasks = tasks.map((t) => ({
    kind: t.kind, prompt: t.prompt, repoId: t.repoId, status: t.status ?? 'draft', attempts: [],
  })) as never;
  // resolveCwd only honours a targetRepoId that is one of the project's OWN repos, so
  // every repoId referenced by a task must be present in details.repos for the fixture.
  const repoIds = [...new Set(tasks.map((t) => t.repoId).filter(Boolean) as string[])];
  d.repos = repoIds.map((id) => ({ id, name: id, pathOnDisk: '/repo/path', defaultBranch: 'main' })) as never;
  return d;
}

const client = {} as never; // unused — dispatchMma is mocked
const okStat = async () => {};

beforeEach(() => { dispatchMma.mockClear(); updateDetails.mockClear(); recordActivity.mockClear(); dispatchMma.mockResolvedValue({ batchRowId: 'row-1', batchId: 'ext-1' }); });

describe('dispatchTasks — centralized fan-out (R4)', () => {
  it('writes a discover roll-up row at dispatch time', async () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.discover.tasks = [
      { kind: 'investigate', prompt: 'Repo', repoId: 'repo-1', status: 'draft', attempts: [] },
      { kind: 'research', prompt: 'Research', status: 'draft', attempts: [] },
      { kind: 'journal', prompt: 'Recall', status: 'draft', attempts: [] },
    ] as never;
    d.repos = [{ id: 'repo-1', name: 'repo-1', pathOnDisk: '/repo/path', defaultBranch: 'main' }] as never;
    const db = createMockDb({
      'select:project': [{ details: d, teamId: 'team-1' }],
      'select:workspace_repo': [{ pathOnDisk: '/repo/path' }],
    });
    await dispatchTasks('proj-1', { id: 'm1' }, { db, client: {} as never, workspaceRoot: '/ws', statPath: async () => {} });
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Analysed 3 tasks — 1 investigate · 1 research · 1 recall',
      eventKey: expect.stringMatching(/^discover-rollup:proj-1:[0-9a-f]{16}$/),
    }));
  });

  it('dispatches each draft via dispatchMma with handler:null + taskId, then links the task', async () => {
    const d = detailsWith([
      { kind: 'investigate', prompt: 'How does auth work?', repoId: 'repo-1' },
      { kind: 'research', prompt: 'Compare caching strategies for the API layer' },
    ]);
    const db = createMockDb({ 'select:project': [{ details: d, teamId: 'team-1' }], 'select:workspace_repo': [{ pathOnDisk: '/repo/path' }] });

    const outcomes = await dispatchTasks('proj-1', { id: 'm1' }, { db, client, statPath: okStat });

    expect(dispatchMma).toHaveBeenCalledTimes(2);
    const inv = dispatchMma.mock.calls[0]![0] as Record<string, unknown>;
    expect(inv.route).toBe('investigate');
    expect(inv.handler).toBeNull();
    expect(inv.label).toBe('discover-investigate');
    expect(inv.taskId).toBe('task-0');
    expect(inv.await).toBe(false);
    expect(inv.cwd).toBe('/repo/path');
    expect((inv.body as Record<string, unknown>).prompt).toBe('How does auth work?');

    const res = dispatchMma.mock.calls[1]![0] as Record<string, unknown>;
    expect(res.route).toBe('research');
    expect(res.cwd).toBe('/ws'); // research runs at the workspace root
    expect((res.body as Record<string, unknown>).prompt).toContain('Background:');

    // Both succeeded → task-link flip ran for each.
    expect(updateDetails).toHaveBeenCalledTimes(2);
    expect(outcomes).toEqual([
      { taskId: 'task-0', ok: true, batchId: 'ext-1' },
      { taskId: 'task-1', ok: true, batchId: 'ext-1' },
    ]);
  });

  it('investigate with no repo → cwd_missing, never dispatched', async () => {
    const d = detailsWith([{ kind: 'investigate', prompt: 'no repo here' }]);
    const db = createMockDb({ 'select:project': [{ details: d, teamId: 'team-1' }], 'select:workspace_repo': [] });

    const outcomes = await dispatchTasks('proj-1', { id: 'm1' }, { db, client, statPath: okStat });

    expect(dispatchMma).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ taskId: 'task-0', ok: false, reason: 'cwd_missing', message: 'No cwd for task.' }]);
  });

  it('investigate targetRepoId not in the project repo subset → cwd_missing, never dispatched', async () => {
    // Tenant guard: a client-supplied repoId that is NOT one of the project's own repos
    // (details.repos) must never resolve to a cwd, so a worker can't be pointed at
    // another team's repo directory. detailsWith only seeds repos referenced by tasks —
    // here we override details.repos to a DIFFERENT id than the task's targetRepoId.
    const d = detailsWith([{ kind: 'investigate', prompt: 'point me at another team', repoId: 'foreign-repo' }]);
    d.repos = [{ id: 'my-own-repo', name: 'mine', pathOnDisk: '/repo/path', defaultBranch: 'main' }] as never;
    const db = createMockDb({ 'select:project': [{ details: d, teamId: 'team-1' }], 'select:workspace_repo': [{ pathOnDisk: '/repo/path' }] });

    const outcomes = await dispatchTasks('proj-1', { id: 'm1' }, { db, client, statPath: okStat });

    expect(dispatchMma).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ taskId: 'task-0', ok: false, reason: 'cwd_missing', message: 'No cwd for task.' }]);
  });

  it('a dispatchMma throw → dispatch_failed outcome, no task-link flip', async () => {
    dispatchMma.mockRejectedValueOnce(new Error('MMA dispatch to /task (investigate) failed with HTTP 500'));
    const d = detailsWith([{ kind: 'investigate', prompt: 'boom', repoId: 'repo-1' }]);
    const db = createMockDb({ 'select:project': [{ details: d, teamId: 'team-1' }], 'select:workspace_repo': [{ pathOnDisk: '/repo/path' }] });

    const outcomes = await dispatchTasks('proj-1', { id: 'm1' }, { db, client, statPath: okStat });

    expect(dispatchMma).toHaveBeenCalledTimes(1);
    expect(updateDetails).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ taskId: 'task-0', ok: false, reason: 'dispatch_failed', message: 'MMA dispatch failed.' }]);
  });

  /**
   * The one production caller discards the return value, so these outcomes were read
   * by this file and nothing else: a task that could not start stayed `draft` on the
   * rail with no explanation anywhere the user can see. The failure has to reach the
   * project timeline.
   */
  it('tells the user when a task could not start, instead of only returning it', async () => {
    dispatchMma.mockRejectedValueOnce(new Error('HTTP 500'));
    const d = detailsWith([
      { kind: 'investigate', prompt: 'boom', repoId: 'repo-1' },
      { kind: 'journal', prompt: 'prior work' },
    ]);
    const db = createMockDb({ 'select:project': [{ details: d, teamId: 'team-1' }], 'select:workspace_repo': [{ pathOnDisk: '/repo/path' }] });

    await dispatchTasks('proj-1', { id: 'm1' }, { db, client, statPath: okStat });

    const errorRows = recordActivity.mock.calls
      .map((c) => c[0])
      .filter((a) => a.kind === 'error');
    expect(errorRows).toHaveLength(1);
    expect(errorRows[0]!.label).toContain('1 of 2 discovery tasks could not start');
    expect(errorRows[0]!.label).toContain('MMA dispatch failed.');
    // No eventKey — the idempotency index would collapse a repeated failure into silence.
    expect(errorRows[0]!.eventKey).toBeUndefined();
  });

  it('records no failure row when every task dispatches', async () => {
    const d = detailsWith([{ kind: 'journal', prompt: 'prior work' }]);
    const db = createMockDb({ 'select:project': [{ details: d, teamId: 'team-1' }], 'select:workspace_repo': [] });

    await dispatchTasks('proj-1', { id: 'm1' }, { db, client, statPath: okStat });

    const kinds = recordActivity.mock.calls.map((c) => c[0].kind);
    expect(kinds).not.toContain('error');
  });
});
