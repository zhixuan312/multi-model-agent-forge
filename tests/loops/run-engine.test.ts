// @vitest-environment node
import { vi } from 'vitest';
import { runLoopForRepo, buildBranch, type LoopRunDeps, type LoopRepoTarget } from '@/loops/run-engine';
import type { LoopRow } from '@/db/schema/loop';
import { createMockDb, type MockDb } from '../test-utils/mock-db';

const repo: LoopRepoTarget = { id: 'r1', name: 'mma-forge', pathOnDisk: '/w/forge' };
const loop = {
  id: 'loop-1',
  teamId: 'team-1',
  name: 'Hygiene',
  kind: 'maintenance',
  config: { goalMd: 'no dormant code' },
  workerTier: 'complex',
  mode: 'event',
  cron: null,
  targetBranch: null,
  repoIds: ['r1'],
  eventTokenHash: 'hash-1',
  enabled: true,
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as LoopRow;
const ctx = {
  runId: '11111111-2222-3333-4444-555555555555',
  trigger: 'event' as const,
  goalOverride: 'Investigate incident INC-123 and fix the root cause',
  idempotencyKey: 'evt-123',
  reference: 'INC-123',
  context: 'Error rate exceeded 5% in prod',
};

function makeDeps(over: Partial<LoopRunDeps> = {}): LoopRunDeps & Record<string, ReturnType<typeof vi.fn>> {
  const base = {
    db: createMockDb({ 'insert:loop_run': [{ id: 'run-1' }], 'update:loop_run': [{ id: 'run-1' }] }),
    hasGitToken: vi.fn(async () => true),
    isSupportedRepo: vi.fn(async () => true),
    resolveCurrentBranch: vi.fn(async () => 'main'),
    mainSession: vi.fn(async ({ prompt }: { prompt: string }) =>
      prompt.includes('planning brain')
        ? { output: '{"recalls":[{"query":"q1","purpose":"p1"}],"verifyCommand":"npm test"}' }
        : { output: '{"entries":[{"tag":"learned","text":"real insight"}]}' },
    ),
    recall: vi.fn(async () => 'prior context'),
    createWorktree: vi.fn(async () => ({ path: '/wt/forge' })),
    dispatch: vi.fn(async () => ({ mmaBatchId: 'b1', keyChanges: ['removed dead module'], filesChanged: ['a.ts'] })),
    runVerify: vi.fn(async () => ({ command: 'npm test', passed: true, detail: 'all green' })),
    branchHasChanges: vi.fn(async () => true),
    commitAndPush: vi.fn(async () => ({ commitSha: 'sha1' })),
    openPr: vi.fn(async () => ({ prUrl: 'https://github.com/x/y/pull/1' })),
    record: vi.fn(async () => {}),
    removeWorktree: vi.fn(async () => {}),
    now: () => new Date('2026-06-15T03:00:00.000Z'),
  };
  return { ...base, ...over } as never;
}
const setPatch = (d: ReturnType<typeof makeDeps>) => {
  const db = d.db as unknown as MockDb;
  return (db._callsFor('loop_run').find((c) => c.method === 'set')?.args[0] ?? {}) as Record<string, unknown>;
};

describe('buildBranch', () => {
  // Same mma/<date>-<slug> shape as project + flow branches; the date carries a millisecond
  // time because a loop fires repeatedly and each run needs its own branch.
  it('is mma/<date>-<time>-<slug> with no run-id suffix, stamped in SGT', () => {
    // 03:04:05.678Z is 11:04:05.678 in Asia/Singapore (UTC+8), the zone loops are
    // scheduled and displayed in.
    expect(buildBranch('Code Hygiene!', new Date('2026-06-15T03:04:05.678Z'))).toBe('mma/2026-06-15-110405678-code-hygiene');
  });

  it('stamps the SGT day, not the UTC day, for a run before 08:00 SGT', () => {
    // 23:30Z on the 14th is 07:30 SGT on the 15th — the Loops UI says the 15th, so the
    // branch must too.
    expect(buildBranch('Nightly', new Date('2026-06-14T23:30:00.000Z'))).toBe('mma/2026-06-15-073000000-nightly');
  });

  it('distinguishes two runs of the same loop on the same day', () => {
    const a = buildBranch('Nightly', new Date('2026-06-15T03:00:00.001Z'));
    const b = buildBranch('Nightly', new Date('2026-06-15T03:00:00.002Z'));
    expect(a).not.toBe(b);
  });
});

describe('runLoopForRepo', () => {
  it('uses goalOverride for the worker prompt and persists event traceability', async () => {
    const d = makeDeps();
    await runLoopForRepo(loop, repo, ctx, d);
    expect(d.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('Investigate incident INC-123 and fix the root cause'),
    }));
    expect(d.mainSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ prompt: expect.stringContaining('Investigate incident INC-123 and fix the root cause') }),
    );
    expect(d.openPr).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('INC-123'),
    }));
    const p = setPatch(d);
    expect(p.status).toBe('changed');
    expect(p.reference).toBe('INC-123');
  });

  it('falls back to config.goalMd when no goalOverride exists', async () => {
    const d = makeDeps();
    await runLoopForRepo(loop, repo, { ...ctx, goalOverride: undefined, reference: null, context: null }, d);
    expect(d.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('no dormant code'),
    }));
  });
});

/**
 * Branch components go through ONE slug rule (`build/slug.ts`), the same one that names
 * project branches. The loop engine had a private `kebab` that stripped `.` and `_` where
 * the shared rule keeps them, so two functions decided what a branch component may
 * contain and a change to the git-ref rules would have reached only one of them.
 */
describe('the loop branch uses the shared git-ref slug rule', () => {
  it('slugs a loop name exactly as slugRefComponent does', async () => {
    const { slugRefComponent } = await import('@/build/slug');
    const at = new Date('2026-06-15T03:04:05.678Z');
    for (const name of ['Code Hygiene!', 'repo.cleanup', 'Nightly_Sweep', 'a//b', 'Ünïcode name']) {
      const expected = slugRefComponent(name) || 'loop';
      expect(buildBranch(name, at).endsWith(`-${expected}`), `${name} → ${buildBranch(name, at)}`).toBe(true);
    }
  });

  it('still falls back for a name that slugs to nothing', () => {
    expect(buildBranch('!!!', new Date('2026-06-15T03:04:05.678Z'))).toMatch(/-loop$/);
  });
});

/**
 * The PR body is assembled from an array of lines and `.filter(Boolean)`, which was meant
 * to drop the OPTIONAL sections (`null` when there is no reference or context). Empty
 * strings are falsy too, so it dropped every blank-line separator as well and the body
 * arrived as one unbroken block — the goal text running straight into the next heading.
 */
describe('the PR body keeps its paragraph structure', () => {
  it('separates each section with a blank line', async () => {
    const d = makeDeps();
    await runLoopForRepo(loop, repo, ctx, d);
    const body = (vi.mocked(d.openPr).mock.calls[0][0] as { body: string }).body;
    expect(body).toMatch(/\n\n## Goal\n/);
    expect(body).toMatch(/\n\n## Key changes\n/);
    // The banner is its own paragraph, not glued to what follows.
    expect(body.split('\n')[1]).toBe('');
  });

  it('still omits the optional sections when they are absent', async () => {
    const d = makeDeps();
    await runLoopForRepo(loop, repo, { ...ctx, reference: null, context: null }, d);
    const body = (vi.mocked(d.openPr).mock.calls[0][0] as { body: string }).body;
    expect(body).not.toContain('Reference:');
    expect(body).not.toContain('## Context');
    // No run of three newlines where an omitted section used to sit.
    expect(body).not.toMatch(/\n{3}/);
  });
});

/**
 * The plan and journal turns are OPTIONAL and both log when they fail. A hard run failure
 * — worktree, dispatch, commit, push, PR — was recorded only as the text of a `missed`
 * journal entry on the run row, so the most important failure was the least diagnosable.
 */
describe('a failed run is logged, not only journalled', () => {
  it('emits loop.run_failed naming the repo and run row', async () => {
    const { setLogSink } = await import('@/observability/log-event');
    const records: Array<Record<string, unknown>> = [];
    const restore = setLogSink((r) => { records.push(r as unknown as Record<string, unknown>); });
    try {
      const d = makeDeps({ dispatch: vi.fn(async () => { throw new Error('worker exploded'); }) });
      await runLoopForRepo(loop, repo, ctx, d);
      const failure = records.find((r) => r.event === 'loop.run_failed');
      expect(failure, 'no loop.run_failed record was emitted').toBeDefined();
      expect(failure).toMatchObject({ level: 'error', repo: 'mma-forge', detail: 'worker exploded' });
    } finally {
      restore();
    }
  });
});
