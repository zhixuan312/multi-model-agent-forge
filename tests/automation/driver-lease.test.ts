// @vitest-environment node
import { acquireDriverLease, heartbeatDriverLease, releaseDriverLease } from '@/automation/driver-lease';
import { createMockDb } from '../test-utils/mock-db';

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
