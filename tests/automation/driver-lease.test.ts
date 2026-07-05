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

  it('releaseDriverLease issues an UPDATE scoped to this driver', async () => {
    const db = createMockDb({ 'update:project': [] });
    await releaseDriverLease(db, 'p1', 'driver-A');
    expect(db._assertCalled('project', 'update')).toBe(true);
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
