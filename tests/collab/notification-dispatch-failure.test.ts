// @vitest-environment node
import { pushDispatchFailure } from '@/collab/notification-store';
import { createMockDb } from '../test-utils/mock-db';

// A dispatch_failed notification must be TEAM-SCOPED. ops_notification has no team_id,
// and listNotifications returns memberId=null broadcasts to every member of every team —
// so a broadcast leaked the failing project's name across teams. The fix targets the
// project OWNER (who is on the project's team); no owner → no notification at all.
describe('pushDispatchFailure — team scoping via owner targeting', () => {
  it('targets the project owner, never a global broadcast', async () => {
    const db = createMockDb({ 'insert:ops_notification': [{ id: 'n1' }] });
    await pushDispatchFailure(
      { projectId: 'p1', projectName: 'Team-A Secret', ownerId: 'owner-1', handler: 'execute-pipeline', batchId: 'b1' },
      db as never,
    );
    const valuesCall = db._callsFor('ops_notification').find((c) => c.method === 'values');
    expect(valuesCall).toBeTruthy();
    expect((valuesCall!.args[0] as { memberId: string | null }).memberId).toBe('owner-1');
  });

  it('inserts nothing when the project has no owner (no fallback broadcast)', async () => {
    const db = createMockDb({});
    await pushDispatchFailure(
      { projectId: 'p1', projectName: 'Team-A Secret', ownerId: null, handler: 'execute-pipeline', batchId: 'b1' },
      db as never,
    );
    expect(db._assertCalled('ops_notification', 'insert')).toBe(false);
  });
});
