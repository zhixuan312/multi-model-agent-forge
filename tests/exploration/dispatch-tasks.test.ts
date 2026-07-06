// @vitest-environment node
import { vi } from 'vitest';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

// R4: dispatchTasks fans out discover tasks through the CENTRALIZED dispatchMma
// path (async, handler:null + taskId). We mock dispatchMma to assert the contract
// dispatchTasks hands it, plus the task-link flip it does on success.

const dispatchMma = vi.fn(async (_opts: Record<string, unknown>) => ({ batchRowId: 'row-1', batchId: 'ext-1' }));
vi.mock('@/dispatch/dispatch-helpers', () => ({ dispatchMma }));

const updateDetails = vi.fn(async (_db: unknown, _pid: string, fn: (d: unknown) => unknown) => fn);
vi.mock('@/details/write', () => ({ updateDetails }));
vi.mock('@/observability/action-log', () => ({ logAction: vi.fn(async () => {}) }));
vi.mock('@/observability/poll-log', () => ({ logPoll: vi.fn() }));
vi.mock('@/git/workspace-root', () => ({ resolveWorkspaceRoot: () => '/ws' }));

const { dispatchTasks } = await import('@/exploration/dispatch');

function detailsWith(tasks: Array<{ kind: string; prompt: string; repoId?: string; status?: string }>) {
  const d = buildInitialDetails();
  d.stages.exploration.phases.discover.tasks = tasks.map((t) => ({
    kind: t.kind, prompt: t.prompt, repoId: t.repoId, status: t.status ?? 'draft', attempts: [],
  })) as never;
  return d;
}

const client = {} as never; // unused — dispatchMma is mocked
const okStat = async () => {};

beforeEach(() => { dispatchMma.mockClear(); updateDetails.mockClear(); dispatchMma.mockResolvedValue({ batchRowId: 'row-1', batchId: 'ext-1' }); });

describe('dispatchTasks — centralized fan-out (R4)', () => {
  it('dispatches each draft via dispatchMma with handler:null + taskId, then links the task', async () => {
    const d = detailsWith([
      { kind: 'investigate', prompt: 'How does auth work?', repoId: 'repo-1' },
      { kind: 'research', prompt: 'Compare caching strategies for the API layer' },
    ]);
    const db = createMockDb({ 'select:project': [{ details: d }], 'select:workspace_repo': [{ pathOnDisk: '/repo/path' }] });

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
    const db = createMockDb({ 'select:project': [{ details: d }], 'select:workspace_repo': [] });

    const outcomes = await dispatchTasks('proj-1', { id: 'm1' }, { db, client, statPath: okStat });

    expect(dispatchMma).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ taskId: 'task-0', ok: false, reason: 'cwd_missing', message: 'No cwd for task.' }]);
  });

  it('a dispatchMma throw → dispatch_failed outcome, no task-link flip', async () => {
    dispatchMma.mockRejectedValueOnce(new Error('MMA dispatch to /task (investigate) failed with HTTP 500'));
    const d = detailsWith([{ kind: 'investigate', prompt: 'boom', repoId: 'repo-1' }]);
    const db = createMockDb({ 'select:project': [{ details: d }], 'select:workspace_repo': [{ pathOnDisk: '/repo/path' }] });

    const outcomes = await dispatchTasks('proj-1', { id: 'm1' }, { db, client, statPath: okStat });

    expect(dispatchMma).toHaveBeenCalledTimes(1);
    expect(updateDetails).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ taskId: 'task-0', ok: false, reason: 'dispatch_failed', message: 'MMA dispatch failed.' }]);
  });
});
