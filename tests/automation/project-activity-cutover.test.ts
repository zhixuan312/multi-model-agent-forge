import { describe, expect, it, vi } from 'vitest';
import { recordDriverOnlyLine } from '@/automation/driver';
import { reconcileStuckAttempts } from '@/automation/details-actions';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

/**
 * The cutover is DONE, so this file no longer pretends to watch the old writers.
 *
 * It used to `vi.mock('@/details/write')` in `appendProjectEvent` and
 * `resolveRunningEvent` and then assert `not.toHaveBeenCalled()`. Neither is exported any
 * more — `details/write.ts` has no such functions, nothing in `src`/`app` references them,
 * and the `Details` schema has no `events` field at all. So the mocks INVENTED the symbols
 * they were watching, and three assertions could not fail: a function that does not exist
 * is never called. `legacy-events-removal.test.ts` is what actually pins the removal.
 *
 * What is left is the real claim: these paths record through `project_activity`.
 */
const { recordActivity } = vi.hoisted(() => ({ recordActivity: vi.fn(async () => {}) }));

vi.mock('@/activity/project-activity', () => ({ recordActivity }));

describe('project_activity cutover', () => {
  it('reconcileStuckAttempts records exactly one retry error row and does not push details.events', async () => {
    recordActivity.mockClear();
    const d = buildInitialDetails();
    d.stages.execute.status = 'active';
    d.stages.execute.phases.implement.repos = [{ repoId: 'repo-1', attempts: [{ batchId: 'batch-1', status: 'running', at: '2026-07-10T00:00:00.000Z' }] }];
    const db = createMockDb({
      'select:project': [{ details: d }, { details: d, detailsVersion: 1 }],
      // reconcileStuckAttempts reads the terminal STATUS too (failed → retry,
      // cancelled → park), so the row must carry it as the real query returns it.
      'select:ops_mma_batch': [{ id: 'batch-1', status: 'failed' }],
      'update:project': [{ id: 'proj-1' }],
      'select:team_member': [{ id: '00000000-0000-0000-0000-000000000000', displayName: 'Forge', avatarTint: '#9a6b4f' }],
    });
    await reconcileStuckAttempts(db, 'proj-1');
    expect(recordActivity).toHaveBeenCalledTimes(1);
  });

  it('records a driver-only terminal line through project_activity, not details.events', async () => {
    recordActivity.mockClear();
    const db = createMockDb({ 'insert:project_activity': [{ id: 'a1' }] });
    await recordDriverOnlyLine(db, 'proj-1', '', '', 'All stages complete — project finished', 'done');
    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj-1',
      label: 'All stages complete — project finished',
      kind: 'done',
      source: 'mma',
    }));
  });
});
