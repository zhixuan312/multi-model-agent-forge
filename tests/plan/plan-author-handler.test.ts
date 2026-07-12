import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '../test-utils/mock-db';

const publish = vi.fn();

vi.mock('@/sse/event-bus', () => ({
  projectEventBus: { publish },
}));

vi.mock('@/projects/project-files', () => ({
  readPlanFile: vi.fn().mockResolvedValue({
    version: 3,
    updatedAt: '2026-07-11',
    bodyMd: `## Track 1

### Task I-1: Extend the route surface

Body 1

### Task I-2: Swap the route

Body 2
`,
  }),
}));

describe('plan-author handler', () => {
  it('enrolls parsed tasks, sets refine.file, closes the running attempt, and publishes plan.authored', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const details = buildInitialDetails();
    details.repos = [{ id: 'repo-1', name: 'forge', pathOnDisk: '/tmp/forge', defaultBranch: 'main' }];
    details.stages.plan.phases.refine.attempts = [{ batchId: 'batch-1', status: 'running', at: '2026-07-11T00:00:00.000Z' }];

    const db = createMockDb({
      'select:project': [{ details }],
      'update:project': [{ id: 'proj-1' }],
    });

    await import('@/dispatch/handlers/plan-author');
    const { getHandler } = await import('@/dispatch/handler-registry');
    const handler = getHandler('plan-author')!;

    await handler(db, {
      batchRowId: 'row-1',
      projectId: 'proj-1',
      handler: 'plan-author',
      request: { actorId: 'member-1' },
      actorId: 'member-1',
    }, {});

    expect(publish).toHaveBeenCalledWith('proj-1', expect.objectContaining({
      type: 'plan.authored',
      writeTargets: ['forge'],
    }));
  });
});
