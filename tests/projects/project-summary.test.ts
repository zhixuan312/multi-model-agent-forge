import { describe, it, expect, vi } from 'vitest';
import { loadProjectSummary } from '@/projects/project-summary';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

vi.mock('@/projects/project-files', () => ({
  readSpecFileAsync: vi.fn().mockResolvedValue({ version: 5, updatedAt: '2026-07-01', bodyMd: '' }),
  readPlanFileAsync: vi.fn().mockResolvedValue({ version: 3, updatedAt: '2026-07-01', bodyMd: '' }),
}));

const PROJECT_ID = 'proj-1';

describe('loadProjectSummary', () => {
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
