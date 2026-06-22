// @vitest-environment node
import { vi } from 'vitest';
import { MmaClient, type MmaClientConfig } from '@/mma/client';
import { PollManager } from '@/sse/poll-manager';
import { ProjectEventBus } from '@/sse/event-bus';
import { dispatchTasks } from '@/exploration/dispatch';
import { createMockDb } from '../test-utils/mock-db';

const cfg: MmaClientConfig = { baseUrl: 'http://127.0.0.1:7337', token: 't', mainModel: 'm' };

interface RodCall {
  route: string;
  cwd: string;
  body: Record<string, unknown>;
}

/** An MmaClient whose POST always succeeds (202 batchId) and records the call. */
function okClient(calls: RodCall[], fail = false): MmaClient {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const u = new URL(url);
    calls.push({
      route: u.pathname.replace(/^\//, ''),
      cwd: u.searchParams.get('cwd') ?? '',
      body: init?.body ? JSON.parse(init.body as string) : {},
    });
    if (fail) return new Response('err', { status: 503 });
    return new Response(JSON.stringify({ taskId: `mma-${calls.length}` }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return new MmaClient(cfg, { fetchImpl, client: 'claude-code' });
}

function pm(db = createMockDb()): PollManager {
  const p = new PollManager({ db, client: okClient([]), bus: new ProjectEventBus() });
  p.disableTimers();
  return p;
}

describe('dispatchTasks', () => {
  it('creates one ops_mma_batch per task with the right cwd per route + flips to running', async () => {
    const db = createMockDb({
      'select:project_exploration_task': [
        { id: 'task-1', projectId: 'proj-1', kind: 'investigate', targetRepoId: 'repo-1', prompt: 'how does this work?', status: 'draft', createdBy: 'member-1', createdAt: new Date() },
        { id: 'task-2', projectId: 'proj-1', kind: 'research', targetRepoId: null, prompt: 'what external approaches exist for this problem?', status: 'draft', createdBy: 'member-1', createdAt: new Date() },
        { id: 'task-3', projectId: 'proj-1', kind: 'journal', targetRepoId: null, prompt: 'what did we learn before about this?', status: 'draft', createdBy: 'member-1', createdAt: new Date() },
      ],
      'select:workspace_repo': [{ id: 'repo-1', projectId: 'proj-1', name: 'repo-a', pathOnDisk: '/work/a', defaultBranch: 'main', createdAt: new Date(), updatedAt: new Date() }],
      'insert:ops_mma_batch': [
        { id: 'batch-1', projectId: 'proj-1', route: 'investigate', targetRepoId: 'repo-1', cwd: '/work/a', request: {}, dispatchedBy: 'member-1', createdAt: new Date() },
      ],
      'update:project_exploration_task': [{ id: 'task-1', projectId: 'proj-1', kind: 'investigate', targetRepoId: 'repo-1', prompt: 'how does this work?', status: 'running', createdBy: 'member-1', createdAt: new Date() }],
    });

    const calls: RodCall[] = [];
    const out = await dispatchTasks('proj-1', { id: 'member-1' }, {
      db,
      client: okClient(calls),
      pollManager: pm(db),
      workspaceRoot: '/work',
      statPath: async () => {},
    });

    expect(out.every((o) => o.ok)).toBe(true);
    // cwd rules: investigate → repo path; research/journal → workspace root.
    const byRoute = Object.fromEntries(calls.map((c) => [String(c.body.type), c.cwd]));
    expect(byRoute['investigate']).toBe('/work/a');
    expect(byRoute['research']).toBe('/work');
    expect(byRoute['journal_recall']).toBe('/work');
  });

  it('a dispatch POST failure leaves the task draft with NO ops_mma_batch row (F10)', async () => {
    const db = createMockDb({
      'select:project_exploration_task': [{ id: 'task-1', projectId: 'proj-1', kind: 'investigate', targetRepoId: 'repo-1', prompt: 'how does this work?', status: 'draft', createdBy: 'member-1', createdAt: new Date() }],
      'select:workspace_repo': [{ id: 'repo-1', projectId: 'proj-1', name: 'repo-a', pathOnDisk: '/work/a', defaultBranch: 'main', createdAt: new Date(), updatedAt: new Date() }],
    });

    const out = await dispatchTasks('proj-1', { id: 'member-1' }, {
      db,
      client: okClient([], true), // 503 on POST
      pollManager: pm(db),
      workspaceRoot: '/work',
      statPath: async () => {},
    });

    expect(out[0]).toMatchObject({ ok: false, reason: 'dispatch_failed' });
    expect(db._assertCalled('ops_mma_batch', 'insert')).toBe(false);
  });

  it('a missing cwd path fails fast (task stays draft) rather than dispatching', async () => {
    const db = createMockDb({
      'select:project_exploration_task': [{ id: 'task-1', projectId: 'proj-1', kind: 'investigate', targetRepoId: 'repo-1', prompt: 'how does this work?', status: 'draft', createdBy: 'member-1', createdAt: new Date() }],
      'select:workspace_repo': [{ id: 'repo-1', projectId: 'proj-1', name: 'repo-missing', pathOnDisk: '/work/missing', defaultBranch: 'main', createdAt: new Date(), updatedAt: new Date() }],
    });

    const calls: RodCall[] = [];
    const out = await dispatchTasks('proj-1', { id: 'member-1' }, {
      db,
      client: okClient(calls),
      pollManager: pm(db),
      workspaceRoot: '/work',
      statPath: async () => {
        throw new Error('ENOENT');
      },
    });

    expect(out[0]).toMatchObject({ ok: false, reason: 'cwd_missing' });
    expect(calls).toHaveLength(0); // never dispatched
  });

  it('registers each dispatched batch with the PollManager', async () => {
    const db = createMockDb({
      'select:project_exploration_task': [{ id: 'task-1', projectId: 'proj-1', kind: 'investigate', targetRepoId: 'repo-1', prompt: 'how does this work?', status: 'draft', createdBy: 'member-1', createdAt: new Date() }],
      'select:workspace_repo': [{ id: 'repo-1', projectId: 'proj-1', name: 'repo-a', pathOnDisk: '/work/a', defaultBranch: 'main', createdAt: new Date(), updatedAt: new Date() }],
      'insert:ops_mma_batch': [{ id: 'batch-1', projectId: 'proj-1', route: 'investigate', targetRepoId: 'repo-1', cwd: '/work/a', request: {}, dispatchedBy: 'member-1', createdAt: new Date() }],
      'update:project_exploration_task': [{ id: 'task-1', projectId: 'proj-1', kind: 'investigate', targetRepoId: 'repo-1', prompt: 'how does this work?', status: 'running', createdBy: 'member-1', createdAt: new Date() }],
    });
    const manager = pm(db);
    const spy = vi.spyOn(manager, 'register');
    await dispatchTasks('proj-1', { id: 'member-1' }, {
      db,
      client: okClient([]),
      pollManager: manager,
      workspaceRoot: '/work',
      statPath: async () => {},
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ projectId: 'proj-1', route: 'investigate' });
  });
});
