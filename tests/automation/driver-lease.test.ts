// @vitest-environment node
import {
  acquireDriverLease,
  heartbeatDriverLease,
  releaseDriverLease,
  startLeaseHeartbeat,
  DRIVER_HEARTBEAT_INTERVAL_MS,
} from '@/automation/driver-lease';
import { createMockDb } from '../test-utils/mock-db';

const updateCount = (db: ReturnType<typeof createMockDb>) =>
  db._callsFor('project').filter((c) => c.method === 'returning').length;

/**
 * G1 — single-driver lease call-path. The atomic staleness/takeover logic lives in
 * the SQL `WHERE` (not exercised without a real Postgres); these lock in the
 * contract: a claim that touches a row → held; a claim that touches none → not held.
 */
describe('driver lease (G1)', () => {
  it('acquireDriverLease returns true when the atomic UPDATE claims a row', async () => {
    const db = createMockDb({ 'update:project': [{ id: 'p1' }] });
    expect(await acquireDriverLease(db, 'p1', 'driver-A')).toBe(true);
  });

  it('acquireDriverLease returns false when no row is claimed (another live driver holds it)', async () => {
    const db = createMockDb({ 'update:project': [] });
    expect(await acquireDriverLease(db, 'p1', 'driver-B')).toBe(false);
  });

  it('heartbeatDriverLease returns false when this driver no longer holds the lease', async () => {
    const db = createMockDb({ 'update:project': [] }); // 0 rows → lost the lease
    expect(await heartbeatDriverLease(db, 'p1', 'driver-A')).toBe(false);
  });

  /**
   * "Scoped to this driver" was the whole claim, and the case asserted only that SOME
   * update ran. A `releaseDriverLease` that dropped the driver predicate — clearing the
   * lease whoever holds it — passed, and so did one that dropped the project predicate and
   * cleared every project in the table. The scoping IS the safety property: the lease
   * exists so two drivers cannot run one project, and a release that ignores who holds it
   * hands the lease to a thief on the next tick.
   *
   * Walks the bound values the way `lease-stale-threshold.test.ts` does — Drizzle chunks
   * reference their table and so themselves, hence the seen-set.
   */
  it('releaseDriverLease scopes the UPDATE to BOTH this project and this driver', async () => {
    const db = createMockDb({ 'update:project': [] });
    await releaseDriverLease(db, 'p1', 'driver-A');
    expect(db._wasCalled('project', 'update')).toBe(true);

    const where = db._calls.find((c) => c.method === 'where');
    const seen = new WeakSet<object>();
    const bound: string[] = [];
    const walk = (v: unknown): void => {
      if (v === null || v === undefined) return;
      if (typeof v !== 'object') { bound.push(String(v)); return; }
      if (seen.has(v)) return;
      seen.add(v);
      if (v.constructor?.name?.startsWith('Pg')) return; // a table drags in the whole schema
      for (const child of Array.isArray(v) ? v : Object.values(v)) walk(child);
    };
    walk(where?.args ?? []);

    expect(bound, 'the release is not scoped to the project').toContain('p1');
    expect(bound, 'the release would clear a lease another driver holds').toContain('driver-A');
  });
});

/**
 * The load-bearing G1 fix: the heartbeat runs on a BACKGROUND timer, decoupled from
 * the driver loop body (which blocks for minutes inside one MMA dispatch). Without
 * this, the lease goes stale mid-call and another driver steals it → two concurrent
 * drivers, the race G1 exists to prevent.
 */
describe('startLeaseHeartbeat (G1 background heartbeat)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refreshes the lease on the interval, independent of any loop body', async () => {
    const db = createMockDb({ 'update:project': [{ id: 'p1' }] }); // heartbeat holds
    let lost = false;
    const stop = startLeaseHeartbeat(db, 'p1', 'drv', () => { lost = true; });
    await vi.advanceTimersByTimeAsync(DRIVER_HEARTBEAT_INTERVAL_MS * 3 + 1);
    stop();
    expect(updateCount(db)).toBeGreaterThanOrEqual(3); // ~3 ticks in 3 intervals
    expect(lost).toBe(false);
  });

  it('fires onLost when a heartbeat reports the lease was taken over', async () => {
    const db = createMockDb({ 'update:project': [] }); // 0 rows → lease lost
    let lost = false;
    const stop = startLeaseHeartbeat(db, 'p1', 'drv', () => { lost = true; });
    await vi.advanceTimersByTimeAsync(DRIVER_HEARTBEAT_INTERVAL_MS + 1);
    stop();
    expect(lost).toBe(true);
  });

  it('stop() halts further heartbeats', async () => {
    const db = createMockDb({ 'update:project': [{ id: 'p1' }] });
    const stop = startLeaseHeartbeat(db, 'p1', 'drv', () => {});
    await vi.advanceTimersByTimeAsync(DRIVER_HEARTBEAT_INTERVAL_MS + 1);
    const after = updateCount(db);
    stop();
    await vi.advanceTimersByTimeAsync(DRIVER_HEARTBEAT_INTERVAL_MS * 3);
    expect(updateCount(db)).toBe(after); // no ticks after stop()
  });
});
