// @vitest-environment node
import { listAllRuns, latestRunPerLoop } from '@/loops/runs-query';
import { createMockDb } from '../test-utils/mock-db';

const run = (over: Record<string, unknown>) => ({
  id: 'x', loopId: 'l1', runId: 'f1', repoId: 'r1', trigger: 'manual', status: 'changed',
  branch: null, prUrl: null, mmaBatchId: null, keyChanges: null, verification: null,
  filesChanged: null, journalEntries: null, startedAt: new Date(), finishedAt: null, ...over,
});

// teamId is a REQUIRED arg on both queries (fail-closed team scoping). The mock DB cannot
// EVALUATE a WHERE clause, so a missing predicate would still return rows and the shape
// assertions below would pass unchanged. This comment used to defer the real proof to "a
// live two-team database" — there isn't one: `tests/setup.ts` deletes DATABASE_URL, so no
// test reaches Postgres. The scoping is therefore asserted white-box, by reading the bound
// parameters out of the WHERE node (the same approach `team-member-refs.test.ts` uses).
const TEAM = 'team-1';

/** Bound literal values inside a drizzle SQL node, found without walking into cycles. */
function collectParams(node: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  const visit = (v: unknown, depth = 0): void => {
    if (v === null || v === undefined || depth > 8) return;
    if (typeof v !== 'object') { out.push(v); return; }
    if (seen.has(v)) return;
    seen.add(v);
    for (const child of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>)) {
      visit(child, depth + 1);
    }
  };
  visit(node);
  return out;
}

/** Every value bound into a `where(...)` on loop_run. */
function whereParams(db: ReturnType<typeof createMockDb>): unknown[] {
  return db._callsFor('loop_run')
    .filter((c) => c.method === 'where')
    .flatMap((c) => collectParams(c.args[0]));
}

describe('runs-query', () => {
  it('listAllRuns works with and without filters', async () => {
    const db = createMockDb({ 'select:loop_run': [run({ id: 'a' })] }) as never;
    expect((await listAllRuns({ db, teamId: TEAM })).map((r) => r.id)).toEqual(['a']);
    expect((await listAllRuns({ db, teamId: TEAM, loopId: 'l1', status: 'failed' })).map((r) => r.id)).toEqual(['a']);
  });

  it('includes in-progress (running) runs so they show in history', async () => {
    const db = createMockDb({ 'select:loop_run': [run({ id: 'live', status: 'running' })] }) as never;
    expect((await listAllRuns({ db, teamId: TEAM }))[0].status).toBe('running');
  });

  it('listAllRuns binds the caller team into the WHERE, alongside any other filter', async () => {
    const db = createMockDb({ 'select:loop_run': [run({ id: 'a' })] });
    await listAllRuns({ db: db as never, teamId: TEAM, loopId: 'l1', status: 'failed' });
    const params = whereParams(db);
    expect(params).toContain(TEAM);   // the scope
    expect(params).toContain('l1');   // and it did not REPLACE the other predicates
    expect(params).toContain('failed');
  });

  it('latestRunPerLoop binds the caller team too — the index chip is not cross-team', async () => {
    const db = createMockDb({ 'select:loop_run': [run({ id: 'a' })] });
    await latestRunPerLoop({ db: db as never, teamId: TEAM });
    expect(whereParams(db)).toContain(TEAM);
  });

  it('latestRunPerLoop keeps the first (newest) row seen per loop', async () => {
    const db = createMockDb({
      'select:loop_run': [
        run({ id: 'newL1', loopId: 'l1' }),
        run({ id: 'oldL1', loopId: 'l1' }),
        run({ id: 'newL2', loopId: 'l2' }),
      ],
    }) as never;
    const map = await latestRunPerLoop({ db, teamId: TEAM });
    expect(map.l1.id).toBe('newL1');
    expect(map.l2.id).toBe('newL2');
  });
});
