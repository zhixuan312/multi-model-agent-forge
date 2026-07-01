// @vitest-environment node
import { BuildScheduler, type RepoMeta, type RunTaskFn } from '@/build/scheduler';
import type { PlanTaskRow } from '@/db/schema/build';
import type { TaskOutcome } from '@/build/executor';

let seq = 0;
function task(over: Partial<PlanTaskRow> & { id: string; repoId: string }): PlanTaskRow {
  return {
    id: over.id,
    projectId: 'p',
    title: `T${over.id}`,
    targetRepoId: over.repoId,
    dependsOn: over.dependsOn ?? null,
    orderIndex: over.orderIndex ?? seq++,
    reviewPolicy: 'reviewed',
    status: 'queued',
    branch: null,
    targetBranch: null,
    commitSha: null,
    fixNote: null,
    meta: null,
    mmaBatchId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as PlanTaskRow;
}

function repoMap(ids: string[]): Map<string, RepoMeta> {
  return new Map(ids.map((id) => [id, { id, name: id, pathOnDisk: `/work/${id}`, defaultBranch: 'main' }]));
}

/** A runner that records dispatch order + concurrency, returning a scripted outcome. */
function recordingRunner(opts: {
  outcomes?: Record<string, TaskOutcome>;
  onDispatch?: (taskId: string, inflight: Set<string>) => void;
  delayMs?: number;
}): { run: RunTaskFn; order: string[]; maxConcurrentPerRepo: Map<string, number> } {
  const order: string[] = [];
  const inflight = new Set<string>();
  const perRepoInflight = new Map<string, number>();
  const maxConcurrentPerRepo = new Map<string, number>();
  const run: RunTaskFn = async (t: PlanTaskRow) => {
    order.push(t.id);
    inflight.add(t.id);
    perRepoInflight.set(t.targetRepoId, (perRepoInflight.get(t.targetRepoId) ?? 0) + 1);
    maxConcurrentPerRepo.set(
      t.targetRepoId,
      Math.max(maxConcurrentPerRepo.get(t.targetRepoId) ?? 0, perRepoInflight.get(t.targetRepoId)!),
    );
    opts.onDispatch?.(t.id, inflight);
    await new Promise((r) => setTimeout(r, opts.delayMs ?? 2));
    inflight.delete(t.id);
    perRepoInflight.set(t.targetRepoId, perRepoInflight.get(t.targetRepoId)! - 1);
    return opts.outcomes?.[t.id] ?? { status: 'committed', commitSha: `c-${t.id}` };
  };
  return { run, order, maxConcurrentPerRepo };
}

describe('BuildScheduler', () => {
  it('runs two same-repo tasks sequentially (one writer per cwd)', async () => {
    const rec = recordingRunner({});
    const sched = new BuildScheduler(rec.run, { repos: repoMap(['R']) });
    await sched.run([task({ id: 'a', repoId: 'R', orderIndex: 0 }), task({ id: 'b', repoId: 'R', orderIndex: 1 })]);
    expect(rec.maxConcurrentPerRepo.get('R')).toBe(1);
  });

  it('runs disjoint repos in parallel', async () => {
    let bothInflight = false;
    const rec = recordingRunner({
      onDispatch: (_id, inflight) => {
        if (inflight.size >= 2) bothInflight = true;
      },
      delayMs: 10,
    });
    const sched = new BuildScheduler(rec.run, { repos: repoMap(['R1', 'R2']) });
    await sched.run([task({ id: 'a', repoId: 'R1', orderIndex: 0 }), task({ id: 'b', repoId: 'R2', orderIndex: 1 })]);
    expect(bothInflight).toBe(true);
  });

  it('depends_on gating: dependent waits until predecessor committed', async () => {
    const rec = recordingRunner({ delayMs: 5 });
    const sched = new BuildScheduler(rec.run, { repos: repoMap(['R1', 'R2']) });
    const lib = task({ id: 'lib', repoId: 'R1', orderIndex: 0 });
    const consumer = task({ id: 'consumer', repoId: 'R2', orderIndex: 1, dependsOn: ['lib'] });
    await sched.run([lib, consumer]);
    expect(rec.order.indexOf('lib')).toBeLessThan(rec.order.indexOf('consumer'));
  });

  it('concurrency cap: no more than maxConcurrentLanes run at once', async () => {
    let maxSeen = 0;
    const rec = recordingRunner({
      onDispatch: (_id, inflight) => {
        maxSeen = Math.max(maxSeen, inflight.size);
      },
      delayMs: 10,
    });
    const sched = new BuildScheduler(rec.run, { repos: repoMap(['R1', 'R2', 'R3', 'R4', 'R5']), maxConcurrentLanes: 2 });
    await sched.run(['R1', 'R2', 'R3', 'R4', 'R5'].map((r, i) => task({ id: r, repoId: r, orderIndex: i })));
    expect(maxSeen).toBeLessThanOrEqual(2);
  });

  it('a failed task halts ITS repo lane; a disjoint repo still advances', async () => {
    const rec = recordingRunner({
      outcomes: { fail: { status: 'failed', reason: 'boom' } },
      delayMs: 2,
    });
    const sched = new BuildScheduler(rec.run, { repos: repoMap(['R1', 'R2']) });
    const failTask = task({ id: 'fail', repoId: 'R1', orderIndex: 0 });
    const dependent = task({ id: 'dep', repoId: 'R1', orderIndex: 1 });
    const other = task({ id: 'ok', repoId: 'R2', orderIndex: 2 });
    const result = await sched.run([failTask, dependent, other]);
    expect(result.failed).toContain('fail');
    expect(result.haltedRepos).toContain('R1');
    expect(result.committed).toContain('ok'); // disjoint repo advanced
    expect(rec.order).not.toContain('dep'); // halted lane did not run the next same-repo task
  });

  it('a halt outcome stops the lane', async () => {
    const rec = recordingRunner({ outcomes: { h: { status: 'halt', marker: 'cannot implement' } } });
    const sched = new BuildScheduler(rec.run, { repos: repoMap(['R']) });
    const result = await sched.run([task({ id: 'h', repoId: 'R', orderIndex: 0 }), task({ id: 'next', repoId: 'R', orderIndex: 1 })]);
    expect(result.halted).toContain('h');
    expect(rec.order).not.toContain('next');
  });
});
