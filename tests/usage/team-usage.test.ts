// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { usageOverview } from '@/usage/usage-core';
import { createMockDb } from '../test-utils/mock-db';

const batch = { id: 'b1', teamId: 'team-a', route: 'delegate', status: 'done', costUsd: 1.25, savedVsMainUsd: 2.5, inputTokens: 100, outputTokens: 50, durationMs: 1200, createdAt: new Date(), projectId: null };

describe('team usage aggregations', () => {
  it('filters overview by teamId', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [batch] });
    const result = await usageOverview('month', { db, teamId: 'team-b' });
    expect(result.metrics.taskCount).toBe(0);
  });

  it('returns a daily trend series for the chart', async () => {
    const db = createMockDb({
      'select:ops_mma_batch': [{ date: '2026-07-01', costUsd: 1.25, savedUsd: 2.5, count: 3 }],
    });
    const result = await usageOverview('month', { db, teamId: 'team-a' });
    expect(Array.isArray(result.trend)).toBe(true);
    expect(result.trend[0]).toMatchObject({ date: '2026-07-01', costUsd: 1.25, savedUsd: 2.5, count: 3 });
  });
});

/**
 * A usage read must state who it is for.
 *
 * `UsageDeps.teamId` used to be optional and every reader defaulted `deps` to `{}`, so
 * `usageOverview('month')` compiled, ran, and returned every team's totals.
 * `teamScopeFilter` returned `undefined` for a missing team, which Drizzle treats as "no
 * predicate" — the read failed OPEN and nothing reported the mistake.
 *
 * The journal FAQ list failed in exactly that way and reached a user: a new team opened
 * the Recall tab and saw another team's questions and stored answers.
 *
 * Two gates now. The union in `UsageDeps` rejects a missing scope at compile time, which
 * is the real protection for TypeScript callers. The runtime check below covers what the
 * compiler cannot see — a JavaScript caller, a cast, or a `deps` object built at runtime.
 *
 * The organisation dashboard still reads every team, because the organisation dashboard
 * exists to do that. The read is now spelled `scope: 'org'` instead of being what happens
 * when a caller forgets.
 */
describe('a usage read must name its scope', () => {
  it('throws when neither a team nor an org scope is given', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [batch] });
    // `as never` reproduces a caller the compiler cannot check.
    await expect(usageOverview('month', { db } as never)).rejects.toThrow(/teamId.*scope: "org"/);
  });

  it('throws for an empty team id rather than reading every team', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [batch] });
    await expect(usageOverview('month', { db, teamId: '' } as never)).rejects.toThrow(/teamId/);
  });

  it('reads every team only when the caller asks for the org scope', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [batch] });
    const result = await usageOverview('month', { db, scope: 'org' });
    // The org overview returns a different shape; the point here is that the call succeeds
    // and does not throw, which is what separates a deliberate org read from a forgotten team.
    expect(result).toBeDefined();
  });

  it('binds the team into the query for a team-scoped read', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [batch] });
    await usageOverview('month', { db, teamId: 'team-a' });
    const seen = new WeakSet<object>();
    const values: string[] = [];
    const walk = (v: unknown): void => {
      if (v === null || v === undefined) return;
      if (typeof v !== 'object') { values.push(String(v)); return; }
      if (seen.has(v)) return;
      seen.add(v);
      if (v.constructor?.name?.startsWith('Pg')) return;
      for (const child of Array.isArray(v) ? v : Object.values(v)) walk(child);
    };
    for (const c of db._calls.filter((c) => c.method === 'where')) walk(c.args);
    expect(values, 'the team must reach the WHERE, not just the function argument').toContain('team-a');
  });
});
