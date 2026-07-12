import { describe, it, expect, vi } from 'vitest';
import { loadProjectSummary } from '@/projects/project-summary';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

vi.mock('@/projects/project-files', () => ({
  readSpecFile: vi.fn().mockResolvedValue({ version: 5, updatedAt: '2026-07-01', bodyMd: '' }),
  readPlanFile: vi.fn().mockResolvedValue({ version: 3, updatedAt: '2026-07-01', bodyMd: '' }),
}));

const PROJECT_ID = 'proj-1';

describe('loadProjectSummary', () => {
  it('maps project_activity rows into the shared event shape', async () => {
    const db = createMockDb({
      'select:project': [{ name: 'Demo', createdAt: new Date('2026-06-01'), completedAt: null, details: null }],
      'select:ops_mma_batch': [],
      'select:project_activity': [{
        id: 'a1',
        projectId: 'proj-1',
        seq: 1,
        stage: 'spec',
        phase: 'craft',
        label: 'Drafted spec',
        kind: 'done',
        actorId: 'm1',
        actorName: 'Avery',
        actorTint: '#09f',
        source: 'mma',
        durationMs: 1200,
        eventKey: 'spec-auto-draft:batch-1',
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
      }],
    });
    const summary = await loadProjectSummary(db, 'proj-1');
    expect(summary.events[0]).toEqual({
      id: 'a1',
      seq: 1,
      stage: 'spec',
      phase: 'craft',
      label: 'Drafted spec',
      kind: 'done',
      actorName: 'Avery',
      actorTint: '#09f',
      source: 'mma',
      durationMs: 1200,
      eventKey: 'spec-auto-draft:batch-1',
      createdAt: '2026-07-10T00:00:00.000Z',
    });
  });

  it('returns a complete summary with all 6 sections', async () => {
    const d = buildInitialDetails();
    for (const kind of ['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const) {
      d.stages[kind].status = 'done';
      d.stages[kind].startedAt = '2026-06-01T00:00:00Z';
      d.stages[kind].completedAt = '2026-06-02T00:00:00Z';
    }
    d.stages.spec.phases.finalize.auditPasses = [
      { passNo: 1, status: 'revised', audit: { attempts: [{ batchId: 'a1', status: 'done', at: '' }] } },
      { passNo: 2, status: 'clean', audit: { attempts: [{ batchId: 'a2', status: 'done', at: '' }] } },
    ];
    d.stages.plan.phases.refine.tasks = [
      { id: 't1', title: 'Task 1', status: 'approved', approvals: ['m1'], attempts: [], reviewPolicy: 'reviewed' },
      { id: 't2', title: 'Task 2', status: 'approved', approvals: ['m1'], attempts: [], reviewPolicy: 'reviewed' },
    ];
    d.stages.journal.phases.journal.learnings = [
      { heading: 'L1', type: 'decision', status: 'recorded' },
      { heading: 'L2', type: 'insight', status: 'recorded' },
    ];

    const mockDb = createMockDb({
      'select:project': [{ name: 'Demo', createdAt: new Date('2026-06-01'), completedAt: null, details: d }],
      'select:ops_mma_batch': [
        { status: 'done', costUsd: '0.05', savedVsMainUsd: '0.02', inputTokens: 1000, outputTokens: 500, durationMs: 3000 },
        { status: 'done', costUsd: '0.03', savedVsMainUsd: '0.01', inputTokens: 800, outputTokens: 300, durationMs: 2000 },
      ],
    });

    const summary = await loadProjectSummary(mockDb, PROJECT_ID);
    expect(summary.projectName).toBe('Demo');
    expect(summary.timeline.stages).toHaveLength(6);
    expect(summary.cost.totalUsd).toBeGreaterThan(0);
    expect(summary.effort.totalCalls).toBe(2);
    expect(summary.quality.auditPasses).toHaveLength(2);
    expect(summary.delivery.totalTasks).toBe(2);
    expect(summary.delivery.approved).toBe(2);
    expect(summary.knowledge.recorded).toBe(2);
  });
});
