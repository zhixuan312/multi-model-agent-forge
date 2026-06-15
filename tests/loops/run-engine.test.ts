// @vitest-environment node
import { vi } from 'vitest';
import { runLoopForRepo, buildBranch, type LoopRunDeps, type LoopRepoTarget } from '@/loops/run-engine';
import type { LoopRow } from '@/db/schema/loop';
import { createMockDb, type MockDb } from '../test-utils/mock-db';

const repo: LoopRepoTarget = { id: 'r1', name: 'mma-forge', pathOnDisk: '/w/forge' };
const loop = {
  id: 'loop-1', name: 'Hygiene', kind: 'maintenance', config: { goalMd: 'no dormant code' },
  workerTier: 'complex', cron: '0 3 * * *', repoIds: ['r1'], enabled: true,
  createdBy: null, createdAt: new Date(), updatedAt: new Date(),
} as unknown as LoopRow;
const ctx = { runId: '11111111-2222-3333-4444-555555555555', trigger: 'schedule' as const };

function makeDeps(over: Partial<LoopRunDeps> = {}): LoopRunDeps & Record<string, ReturnType<typeof vi.fn>> {
  const base = {
    db: createMockDb({ 'insert:loop_run': [{ id: 'run-1' }], 'update:loop_run': [{ id: 'run-1' }] }),
    hasGitToken: vi.fn(async () => true),
    isGithubRepo: vi.fn(async () => true),
    resolveCurrentBranch: vi.fn(async () => 'main'),
    mainSession: vi.fn(async ({ prompt }: { prompt: string }) =>
      prompt.includes('Plan the run')
        ? { output: '{"recalls":[{"query":"q1","purpose":"p1"}],"verifyCommand":"npm test"}', sessionId: 'sess-1' }
        : { output: '{"entries":[{"tag":"learned","text":"real insight"}]}', sessionId: 'sess-1' },
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
  it('is loop/<slug>/<date>-<shortRunId>', () => {
    expect(buildBranch('Code Hygiene!', new Date('2026-06-15T03:00:00Z'), 'abcdef12-xxxx')).toBe('loop/code-hygiene/2026-06-15-abcdef12');
  });
});

describe('runLoopForRepo', () => {
  it('happy path with a diff → commits, opens a PR, records, status=changed', async () => {
    const d = makeDeps();
    await runLoopForRepo(loop, repo, ctx, d);
    const p = setPatch(d);
    expect(p.status).toBe('changed');
    expect(p.prUrl).toBe('https://github.com/x/y/pull/1');
    expect(p.mmaBatchId).toBe('b1');
    // Verification + files are persisted as structured slots, NOT as fake change lines.
    expect(p.verification).toMatchObject({ command: 'npm test', passed: true });
    expect(p.filesChanged).toEqual(['a.ts']);
    expect(p.keyChanges).toEqual(['removed dead module']);
    expect((p.keyChanges as string[]).some((c) => /verification/.test(c))).toBe(false);
    // Main agent drove Plan + Journal across ONE resumed session.
    expect(d.mainSession).toHaveBeenCalledTimes(2);
    const mainCalls = (d.mainSession as unknown as { mock: { calls: { sessionId?: string }[][] } }).mock.calls;
    expect(mainCalls[1][0].sessionId).toBe('sess-1'); // journal resumed the plan session
    expect(d.recall).toHaveBeenCalledWith(repo, 'q1'); // ran the planned recall query
    expect(d.runVerify).toHaveBeenCalledWith(repo, '/wt/forge', 'npm test'); // ran the planned command
    expect(d.branchHasChanges).toHaveBeenCalledWith('/wt/forge', 'main'); // compared loop branch vs base
    expect(d.createWorktree).toHaveBeenCalledWith(repo, expect.any(String), 'main'); // forked from base
    expect(d.openPr).toHaveBeenCalledWith(expect.objectContaining({ base: 'main' }));
    // Journal is the brain's curated entry, not "delegate: done".
    expect(p.journalEntries).toEqual([{ tag: 'learned', text: 'real insight' }]);
    expect(d.record).toHaveBeenCalledWith(repo, [{ tag: 'learned', text: 'real insight' }]);
    expect(d.commitAndPush).toHaveBeenCalled();
    expect(d.openPr).toHaveBeenCalled();
    expect(d.removeWorktree).toHaveBeenCalledWith('/wt/forge');
  });

  it('degrades to a deterministic plan + journal when the main agent is unreachable', async () => {
    const d = makeDeps({ mainSession: vi.fn(async () => { throw new Error('mma main down'); }) });
    await runLoopForRepo(loop, repo, ctx, d);
    const p = setPatch(d);
    expect(p.status).toBe('changed'); // run still completes
    expect(d.recall).toHaveBeenCalledWith(repo, (loop.config as { goalMd: string }).goalMd); // fallback recall = the goal
    expect(d.runVerify).toHaveBeenCalledWith(repo, '/wt/forge', null); // fallback verify = auto-detect
    expect(p.journalEntries).toEqual([{ tag: 'learned', text: 'removed dead module' }]); // fallback journal = worker summary
  });

  it('uses the loop targetBranch as the fork + PR base when set (no default-branch lookup)', async () => {
    const d = makeDeps();
    const loopWithTarget = { ...loop, targetBranch: 'develop' } as unknown as LoopRow;
    await runLoopForRepo(loopWithTarget, repo, ctx, d);
    expect(d.createWorktree).toHaveBeenCalledWith(repo, expect.any(String), 'develop');
    expect(d.branchHasChanges).toHaveBeenCalledWith('/wt/forge', 'develop');
    expect(d.openPr).toHaveBeenCalledWith(expect.objectContaining({ base: 'develop' }));
    expect(d.resolveCurrentBranch).not.toHaveBeenCalled();
  });

  it('no diff (loop branch == base) → no PR, status=no_changes, worktree still cleaned', async () => {
    const d = makeDeps({ branchHasChanges: vi.fn(async () => false) });
    await runLoopForRepo(loop, repo, ctx, d);
    const p = setPatch(d);
    expect(p.status).toBe('no_changes');
    expect(p.prUrl ?? null).toBeNull();
    expect(d.openPr).not.toHaveBeenCalled();
    expect(d.removeWorktree).toHaveBeenCalled();
  });

  it('missing Git token → failed before any dispatch', async () => {
    const d = makeDeps({ hasGitToken: vi.fn(async () => false) });
    await runLoopForRepo(loop, repo, ctx, d);
    expect(setPatch(d).status).toBe('failed');
    expect(d.dispatch).not.toHaveBeenCalled();
    expect(d.createWorktree).not.toHaveBeenCalled();
  });

  it('non-GitHub repo → failed before any dispatch', async () => {
    const d = makeDeps({ isGithubRepo: vi.fn(async () => false) });
    await runLoopForRepo(loop, repo, ctx, d);
    expect(setPatch(d).status).toBe('failed');
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('unresolvable default branch → failed before any dispatch', async () => {
    const d = makeDeps({ resolveCurrentBranch: vi.fn(async () => null) });
    await runLoopForRepo(loop, repo, ctx, d);
    expect(setPatch(d).status).toBe('failed');
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('dispatch failure → failed, NO PR, worktree cleaned up', async () => {
    const d = makeDeps({ dispatch: vi.fn(async () => { throw new Error('mma down'); }) });
    await runLoopForRepo(loop, repo, ctx, d);
    const p = setPatch(d);
    expect(p.status).toBe('failed');
    expect(p.prUrl ?? null).toBeNull();
    expect(d.openPr).not.toHaveBeenCalled();
    expect(d.removeWorktree).toHaveBeenCalledWith('/wt/forge');
  });
});
