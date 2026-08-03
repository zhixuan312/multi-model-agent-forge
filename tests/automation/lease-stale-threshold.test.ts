import { describe, expect, it } from 'vitest';
import { acquireDriverLease, DRIVER_LEASE_STALE_MS } from '@/automation/driver-lease';
import { createMockDb } from '../test-utils/mock-db';

/**
 * The staleness threshold has exactly ONE definition. `acquireDriverLease` decides in
 * SQL whether a lease may be STOLEN; `isForeignLeaseFresh` decides in JS whether it
 * still BLOCKS a transition. Both must mean the same number of seconds.
 *
 * The SQL used to say `interval '60 seconds'` literally. Raising the constant to 120s
 * would then have left a 90s-old lease simultaneously "fresh" to the gate (transitions
 * refused) and "stale" to the acquirer (lease stolen) — two concurrent drivers on one
 * project, which is the precise race the single-driver lease exists to prevent.
 */
describe('the lease staleness threshold has one source', () => {
  /**
   * Every SQL fragment and bound value the acquire query passes to the DB, flattened to
   * one string. Drizzle's chunks reference their table (and so themselves), so this walks
   * with a seen-set rather than JSON.stringify.
   */
  async function acquireSql(): Promise<string> {
    const db = createMockDb();
    await acquireDriverLease(db, 'p1', 'd1');
    const where = db._calls.find((c) => c.method === 'where');
    const seen = new WeakSet<object>();
    const out: string[] = [];
    const walk = (v: unknown): void => {
      if (v === null || v === undefined) return;
      if (typeof v !== 'object') { out.push(String(v)); return; }
      if (seen.has(v)) return;
      seen.add(v);
      // Only the query's own shape matters; a table reference drags in the whole schema.
      if (v.constructor?.name?.startsWith('Pg')) return;
      for (const child of Array.isArray(v) ? v : Object.values(v)) walk(child);
    };
    walk(where?.args ?? []);
    return out.join(' ');
  }

  it('carries the constant into the query rather than a second hardcoded interval', async () => {
    const sql = await acquireSql();
    expect(sql).toContain(String(DRIVER_LEASE_STALE_MS / 1000));
  });

  it('hardcodes no seconds-interval literal of its own', async () => {
    const sql = await acquireSql();
    expect(sql).not.toMatch(/interval\s*.{0,3}\s*\d+\s+seconds/i);
  });
});
