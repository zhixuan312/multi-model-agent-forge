import { describe, expect, it, vi } from 'vitest';
import { recordDriverOnlyLine } from '@/automation/driver';
import { reconcileStuckAttempts } from '@/automation/details-actions';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

const {
  recordActivity,
  appendProjectEvent,
  resolveRunningEvent,
} = vi.hoisted(() => ({
  recordActivity: vi.fn(async () => {}),
  appendProjectEvent: vi.fn(async () => {}),
  resolveRunningEvent: vi.fn(async () => {}),
}));

vi.mock('@/activity/project-activity', () => ({ recordActivity }));
vi.mock('@/details/write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/details/write')>();
  return {
    ...actual,
    appendProjectEvent,
    resolveRunningEvent,
  };
});

describe('project_activity cutover', () => {
  it('reconcileStuckAttempts records exactly one retry error row and does not push details.events', async () => {
    recordActivity.mockClear();
    appendProjectEvent.mockClear();
    resolveRunningEvent.mockClear();
    const d = buildInitialDetails();
    d.stages.execute.status = 'active';
    d.stages.execute.phases.implement.repos = [{ repoId: 'repo-1', attempts: [{ batchId: 'batch-1', status: 'running', at: '2026-07-10T00:00:00.000Z' }] }];
    const db = createMockDb({
      'select:project': [{ details: d }, { details: d, detailsVersion: 1 }],
      'select:ops_mma_batch': [{ id: 'batch-1' }],
      'update:project': [{ id: 'proj-1' }],
      'select:team_member': [{ id: '00000000-0000-0000-0000-000000000000', displayName: 'Forge', avatarTint: '#9a6b4f' }],
    });
    await reconcileStuckAttempts(db, 'proj-1');
    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(appendProjectEvent).not.toHaveBeenCalled();
  });

  it('records a driver-only terminal line through project_activity, not details.events', async () => {
    recordActivity.mockClear();
    appendProjectEvent.mockClear();
    resolveRunningEvent.mockClear();
    const db = createMockDb({ 'insert:project_activity': [{ id: 'a1' }] });
    await recordDriverOnlyLine(db, 'proj-1', '', '', 'All stages complete — project finished', 'done');
    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj-1',
      label: 'All stages complete — project finished',
      kind: 'done',
      source: 'mma',
    }));
    expect(appendProjectEvent).not.toHaveBeenCalled();
    expect(resolveRunningEvent).not.toHaveBeenCalled();
  });
});
