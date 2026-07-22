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
