import { describe, it, expect, vi } from 'vitest';
import { loadProjectSummary, type ProjectSummary } from '@/projects/project-summary';
import { createMockDb } from '../test-utils/mock-db';

vi.mock('@/projects/project-files', () => ({
  readSpecFileAsync: vi.fn().mockResolvedValue({ version: 5, updatedAt: '2026-07-01', bodyMd: '' }),
  readPlanFileAsync: vi.fn().mockResolvedValue({ version: 3, updatedAt: '2026-07-01', bodyMd: '' }),
}));

const PROJECT_ID = 'proj-1';

describe('loadProjectSummary', () => {
  it('returns a complete summary with all 6 sections', async () => {
    const mockDb = createMockDb({
      'select:project': [{ name: 'Demo', createdAt: new Date('2026-06-01'), completedAt: null }],
      'select:project_stage': [
        { kind: 'exploration', status: 'done', startedAt: new Date('2026-06-01'), completedAt: new Date('2026-06-02') },
        { kind: 'spec', status: 'done', startedAt: new Date('2026-06-02'), completedAt: new Date('2026-06-03') },
        { kind: 'plan', status: 'done', startedAt: new Date('2026-06-03'), completedAt: new Date('2026-06-04') },
        { kind: 'execute', status: 'done', startedAt: new Date('2026-06-04'), completedAt: new Date('2026-06-05') },
        { kind: 'review', status: 'done', startedAt: new Date('2026-06-05'), completedAt: new Date('2026-06-06') },
        { kind: 'journal', status: 'done', startedAt: new Date('2026-06-06'), completedAt: new Date('2026-06-07') },
      ],
      'select:ops_mma_batch': [
        { route: 'orchestrate', status: 'done', costUsd: '0.05', savedVsMainUsd: '0.02', inputTokens: 1000, outputTokens: 500, durationMs: 3000 },
        { route: 'audit', status: 'done', costUsd: '0.03', savedVsMainUsd: '0.01', inputTokens: 800, outputTokens: 300, durationMs: 2000 },
      ],
      'select:project_audit_pass': [
        { scope: 'spec', passNo: 1, findingsCount: 5, verdict: 'revised' },
        { scope: 'spec', passNo: 2, findingsCount: 0, verdict: 'clean' },
        { scope: 'plan', passNo: 1, findingsCount: 3, verdict: 'revised' },
      ],
      'select:project_plan_task': [
        { status: 'committed', commitSha: 'abc123' },
        { status: 'committed', commitSha: 'def456' },
        { status: 'failed', commitSha: null },
      ],
      'select:project_learning_candidate': [
        { status: 'recorded', type: 'decision', origin: 'spec' },
        { status: 'recorded', type: 'insight', origin: 'exploration' },
        { status: 'recorded', type: 'challenge', origin: 'execute' },
      ],
    });

    const summary = await loadProjectSummary(mockDb, PROJECT_ID);

    expect(summary.projectName).toBe('Demo');
    expect(summary.timeline.stages).toHaveLength(6);
    expect(summary.cost.totalUsd).toBeGreaterThan(0);
    expect(summary.effort.totalCalls).toBe(2);
    expect(summary.quality.auditPasses).toHaveLength(3);
    expect(summary.delivery.committed).toBe(2);
    expect(summary.knowledge.recorded).toBe(3);
  });

  it('handles empty project with no MMA calls', async () => {
    const mockDb = createMockDb({
      'select:project': [{ name: 'Empty', createdAt: new Date(), completedAt: null }],
      'select:project_stage': [],
      'select:ops_mma_batch': [],
      'select:project_audit_pass': [],
      'select:project_plan_task': [],
      'select:project_learning_candidate': [],
    });

    const summary = await loadProjectSummary(mockDb, PROJECT_ID);

    expect(summary.cost.totalUsd).toBe(0);
    expect(summary.effort.totalCalls).toBe(0);
    expect(summary.delivery.committed).toBe(0);
    expect(summary.knowledge.recorded).toBe(0);
  });
});
