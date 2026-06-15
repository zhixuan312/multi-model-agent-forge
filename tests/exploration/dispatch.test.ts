// @vitest-environment node
import { afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { MmaClient, type MmaClientConfig } from '@/mma/client';
import { PollManager } from '@/sse/poll-manager';
import { ProjectEventBus } from '@/sse/event-bus';
import { dispatchTasks } from '@/exploration/dispatch';
import { seedProject, seedRepo, cleanupExploreFixtures } from './db-fixtures';

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
    return new Response(JSON.stringify({ batchId: `mma-${calls.length}` }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return new MmaClient(cfg, { fetchImpl, client: 'claude-code' });
}

async function seedDraft(opts: {
  projectId: string;
  ownerId: string;
  kind: 'investigate' | 'research' | 'journal';
  targetRepoId?: string | null;
}): Promise<string> {
  const [t] = await getDb()
    .insert(explorationTask)
    .values({
      projectId: opts.projectId,
      kind: opts.kind,
      targetRepoId: opts.targetRepoId ?? null,
      prompt:
        opts.kind === 'research'
          ? 'what external approaches exist for this problem?'
          : opts.kind === 'journal'
            ? 'what did we learn before about this?'
            : 'how does this work?',
      status: 'draft',
      createdBy: opts.ownerId,
    })
    .returning({ id: explorationTask.id });
  return t.id;
}

function pm(): PollManager {
  const p = new PollManager({ client: okClient([]), bus: new ProjectEventBus() });
  p.disableTimers();
  return p;
}

// Live-DB integration suite — gated OFF: tests never touch a database (no test DB
// exists; production must not be mutated). See tests/setup.ts.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('dispatchTasks', () => {
  afterEach(async () => {
    await cleanupExploreFixtures();
  });

  it('creates one mma_batch per task with the right cwd per route + flips to running', async () => {
    const repo = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    await seedDraft({ projectId, ownerId, kind: 'investigate', targetRepoId: repo.id });
    await seedDraft({ projectId, ownerId, kind: 'research' });
    await seedDraft({ projectId, ownerId, kind: 'journal' });

    const calls: RodCall[] = [];
    const out = await dispatchTasks(projectId, { id: ownerId }, {
      client: okClient(calls),
      pollManager: pm(),
      workspaceRoot: '/work',
      statPath: async () => {},
    });

    expect(out.every((o) => o.ok)).toBe(true);
    // cwd rules: investigate → repo path; research/journal → workspace root.
    const byRoute = Object.fromEntries(calls.map((c) => [c.route, c.cwd]));
    expect(byRoute['investigate']).toBe('/work/a');
    expect(byRoute['research']).toBe('/work');
    expect(byRoute['journal-recall']).toBe('/work');

    const batches = await getDb().select().from(mmaBatch).where(eq(mmaBatch.projectId, projectId));
    expect(batches).toHaveLength(3);
    // research/journal-recall: null target_repo_id but a NON-NULL cwd.
    const research = batches.find((b) => b.route === 'research')!;
    expect(research.targetRepoId).toBeNull();
    expect(research.cwd).toBe('/work');
    const inv = batches.find((b) => b.route === 'investigate')!;
    expect(inv.targetRepoId).toBe(repo.id);

    const tasks = await getDb().select({ status: explorationTask.status }).from(explorationTask).where(eq(explorationTask.projectId, projectId));
    expect(tasks.every((t) => t.status === 'running')).toBe(true);
  });

  it('a dispatch POST failure leaves the task draft with NO mma_batch row (F10)', async () => {
    const repo = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const taskId = await seedDraft({ projectId, ownerId, kind: 'investigate', targetRepoId: repo.id });

    const out = await dispatchTasks(projectId, { id: ownerId }, {
      client: okClient([], true), // 503 on POST
      pollManager: pm(),
      workspaceRoot: '/work',
      statPath: async () => {},
    });

    expect(out[0]).toMatchObject({ ok: false, reason: 'dispatch_failed' });
    const [t] = await getDb().select({ status: explorationTask.status }).from(explorationTask).where(eq(explorationTask.id, taskId));
    expect(t.status).toBe('draft'); // unchanged
    const batches = await getDb().select().from(mmaBatch).where(eq(mmaBatch.projectId, projectId));
    expect(batches).toHaveLength(0); // nothing committed
  });

  it('a missing cwd path fails fast (task stays draft) rather than dispatching', async () => {
    const repo = await seedRepo('a', '/work/missing');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const taskId = await seedDraft({ projectId, ownerId, kind: 'investigate', targetRepoId: repo.id });

    const calls: RodCall[] = [];
    const out = await dispatchTasks(projectId, { id: ownerId }, {
      client: okClient(calls),
      pollManager: pm(),
      workspaceRoot: '/work',
      statPath: async () => {
        throw new Error('ENOENT');
      },
    });

    expect(out[0]).toMatchObject({ ok: false, reason: 'cwd_missing' });
    expect(calls).toHaveLength(0); // never dispatched
    const [t] = await getDb().select({ status: explorationTask.status }).from(explorationTask).where(eq(explorationTask.id, taskId));
    expect(t.status).toBe('draft');
  });

  it('registers each dispatched batch with the PollManager', async () => {
    const repo = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    await seedDraft({ projectId, ownerId, kind: 'investigate', targetRepoId: repo.id });

    const manager = pm();
    const spy = vi.spyOn(manager, 'register');
    await dispatchTasks(projectId, { id: ownerId }, {
      client: okClient([]),
      pollManager: manager,
      workspaceRoot: '/work',
      statPath: async () => {},
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ projectId, route: 'investigate' });
  });
});
