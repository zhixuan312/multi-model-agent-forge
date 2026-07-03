import { describe, it, expect, vi } from 'vitest';
import { resolveNextAction } from '@/automation/resolver';
import { createMockDb } from '../test-utils/mock-db';

vi.mock('@/projects/project-files', () => ({
  readSpecFileAsync: vi.fn().mockResolvedValue({ version: 1, bodyMd: '' }),
  readPlanFileAsync: vi.fn().mockResolvedValue(null),
  specFilePath: vi.fn().mockReturnValue('/fake/spec.md'),
  planFilePath: vi.fn().mockReturnValue('/fake/plan.md'),
}));

describe('resolveNextAction', () => {
  it('returns complete when project has completedAt', async () => {
    const db = createMockDb({
      'select:project': [{ phase: 'completed', completedAt: new Date(), currentStage: 'journal' }],
      'select:project_stage': [],
    });
    const action = await resolveNextAction('p1', db);
    expect(action.kind).toBe('complete');
  });

  it('dispatches spec audit when in finalize with no audits', async () => {
    const db = createMockDb({
      'select:project': [{ phase: 'design', completedAt: null, currentStage: 'spec' }],
      'select:project_stage': [
        { kind: 'spec', status: 'active', lastPhase: 'finalize' },
        { kind: 'plan', status: 'pending', lastPhase: null },
      ],
      'select:ops_mma_batch': [],
      'select:project_audit_pass': [],
    });
    const action = await resolveNextAction('p1', db);
    expect(action.kind).toBe('dispatch_spec_audit');
  });

  it('applies findings when latest audit has critical/high and passes < 5', async () => {
    const db = createMockDb({
      'select:project': [{ phase: 'design', completedAt: null, currentStage: 'spec' }],
      'select:project_stage': [
        { kind: 'spec', status: 'active', lastPhase: 'finalize' },
      ],
      'select:ops_mma_batch': [],
      'select:project_audit_pass': [
        { passNo: 1, findingsCount: 3, verdict: 'revised', scope: 'spec' },
      ],
    });
    const action = await resolveNextAction('p1', db);
    expect(action.kind).toBe('apply_spec_findings');
    expect(action.data?.passNo).toBe(1);
  });

  it('freezes spec when audit is clean', async () => {
    const db = createMockDb({
      'select:project': [{ phase: 'design', completedAt: null, currentStage: 'spec' }],
      'select:project_stage': [
        { kind: 'spec', status: 'active', lastPhase: 'finalize' },
      ],
      'select:ops_mma_batch': [],
      'select:project_audit_pass': [
        { passNo: 1, findingsCount: 0, verdict: 'clean', scope: 'spec' },
      ],
    });
    const action = await resolveNextAction('p1', db);
    expect(action.kind).toBe('freeze_spec');
  });

  it('freezes spec when cap of 5 passes reached', async () => {
    const db = createMockDb({
      'select:project': [{ phase: 'design', completedAt: null, currentStage: 'spec' }],
      'select:project_stage': [
        { kind: 'spec', status: 'active', lastPhase: 'finalize' },
      ],
      'select:ops_mma_batch': [],
      'select:project_audit_pass': [
        { passNo: 1, verdict: 'revised', scope: 'spec' },
        { passNo: 2, verdict: 'revised', scope: 'spec' },
        { passNo: 3, verdict: 'revised', scope: 'spec' },
        { passNo: 4, verdict: 'revised', scope: 'spec' },
        { passNo: 5, verdict: 'revised', scope: 'spec' },
      ],
    });
    const action = await resolveNextAction('p1', db);
    expect(action.kind).toBe('freeze_spec');
    expect(action.note).toContain('cap');
  });

  it('validates unapproved plan task before approving', async () => {
    const { readPlanFileAsync } = await import('@/projects/project-files');
    (readPlanFileAsync as any).mockResolvedValueOnce({ version: 1, bodyMd: '# Plan' });
    const db = createMockDb({
      'select:project': [{ phase: 'build', completedAt: null, currentStage: 'plan' }],
      'select:project_stage': [
        { kind: 'spec', status: 'done', lastPhase: 'finalize' },
        { kind: 'plan', status: 'active', lastPhase: 'refine' },
      ],
      'select:project_plan_task': [
        { id: 't1', status: 'queued', title: 'Task 1', orderIndex: 0 },
        { id: 't2', status: 'committed', title: 'Task 2', orderIndex: 1 },
      ],
      'select:ops_mma_batch': [],
      'select:project_qa_message': [],
    });
    const action = await resolveNextAction('p1', db);
    expect(action.kind).toBe('validate_task');
    expect(action.data?.taskId).toBe('t1');
  });

  it('approves task after validation (forge reply exists)', async () => {
    const { readPlanFileAsync } = await import('@/projects/project-files');
    (readPlanFileAsync as any).mockResolvedValueOnce({ version: 1, bodyMd: '# Plan' });
    const db = createMockDb({
      'select:project': [{ phase: 'build', completedAt: null, currentStage: 'plan' }],
      'select:project_stage': [
        { kind: 'spec', status: 'done', lastPhase: 'finalize' },
        { kind: 'plan', status: 'active', lastPhase: 'refine' },
      ],
      'select:project_plan_task': [
        { id: 't1', status: 'queued', title: 'Task 1', orderIndex: 0 },
      ],
      'select:ops_mma_batch': [],
      'select:project_qa_message': [{ sender: 'forge' }],
    });
    const action = await resolveNextAction('p1', db);
    expect(action.kind).toBe('approve_task');
    expect(action.data?.taskId).toBe('t1');
  });

  it('marks complete when all stages done', async () => {
    const db = createMockDb({
      'select:project': [{ phase: 'learn', completedAt: null, currentStage: 'journal' }],
      'select:project_stage': [
        { kind: 'exploration', status: 'done' },
        { kind: 'spec', status: 'done' },
        { kind: 'plan', status: 'done' },
        { kind: 'execute', status: 'done' },
        { kind: 'review', status: 'done' },
        { kind: 'journal', status: 'done' },
      ],
      'select:project_learning_candidate': [
        { id: 'l1', status: 'recorded' },
      ],
      'select:ops_mma_batch': [],
    });
    const action = await resolveNextAction('p1', db);
    expect(action.kind).toBe('mark_complete');
  });
});
