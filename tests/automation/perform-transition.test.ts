import { performTransition, TransitionRejected, isForeignLeaseFresh } from '@/automation/perform-transition';
import { createMockDb } from '../test-utils/mock-db';
import { buildInitialDetails, type Details } from '@/details/schema';

function finalizeActive(): Details {
  const d = buildInitialDetails();
  d.stages.exploration.status = 'done';
  d.stages.spec.status = 'active';
  d.stages.spec.phases.finalize.status = 'active';
  return d;
}

function projRow(details: Details, version = 1, autoStatus: 'off' | 'running' = 'off') {
  details.automation.status = autoStatus;
  return { details, detailsVersion: version, autoMode: autoStatus === 'running' };
}

describe('performTransition — gate (spec §2.4, AC4/AC17)', () => {
  it('rejects an action not in allowedActions', async () => {
    const db = createMockDb({ 'select:project': [projRow(finalizeActive(), 1, 'running')] });
    await expect(
      performTransition(db, 'p', { kind: 'mark_complete', note: '', stage: '', phase: '' }, { mode: 'auto' }),
    ).rejects.toBeInstanceOf(TransitionRejected);
  });

  it('rejects a manual action while auto is running (except take_over) [AC17]', async () => {
    const db = createMockDb({ 'select:project': [projRow(finalizeActive(), 1, 'running')] });
    await expect(
      performTransition(db, 'p', { kind: 'dispatch_audit', note: '', stage: 'spec', phase: 'finalize' }, { mode: 'manual', actorId: 'u1' }),
    ).rejects.toBeInstanceOf(TransitionRejected);
  });

  it('rejects a driver action while auto is off [AC17]', async () => {
    const db = createMockDb({ 'select:project': [projRow(finalizeActive(), 1, 'off')] });
    await expect(
      performTransition(db, 'p', { kind: 'dispatch_audit', note: '', stage: 'spec', phase: 'finalize' }, { mode: 'auto' }),
    ).rejects.toBeInstanceOf(TransitionRejected);
  });

  it('rejects an advancing action while a FRESH FOREIGN lease is held (single-flight)', async () => {
    const d = finalizeActive();
    d.automation.status = 'off'; // manual mode allowed
    d.automation.driverId = 'other-holder';
    d.automation.driverHeartbeatAt = new Date().toISOString(); // fresh
    const db = createMockDb({ 'select:project': [{ details: d, detailsVersion: 1, autoMode: false }] });
    await expect(
      performTransition(db, 'p', { kind: 'dispatch_audit', note: '', stage: 'spec', phase: 'finalize' }, { mode: 'manual', actorId: 'me' }),
    ).rejects.toThrow(/busy/);
  });

  it('does NOT reject as busy when the fresh lease is held by the SAME actor', async () => {
    // A stale/own lease must not trigger the foreign-fresh guard. We assert the guard
    // itself via a direct helper so the test never reaches the real MMA effect.
    const d = finalizeActive();
    d.automation.driverId = 'me';
    d.automation.driverHeartbeatAt = new Date().toISOString();
    expect(isForeignLeaseFresh(d.automation, 'me')).toBe(false);
    expect(isForeignLeaseFresh(d.automation, 'other')).toBe(true);
  });
});
