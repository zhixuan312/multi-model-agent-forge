import { describe, it, expect } from 'vitest';
import { buildInitialDetails } from '@/details/schema';
import { resolveNextActionFromDetails } from '@/automation/details-resolver';

describe('resolveNextActionFromDetails', () => {
  it('returns complete for a fully done project', () => {
    const d = buildInitialDetails();
    for (const stg of Object.values(d.stages)) {
      stg.status = 'done';
      for (const ph of Object.values(stg.phases as Record<string, { status: string }>)) {
        ph.status = 'done';
      }
    }
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('complete');
  });

  it('dispatches spec audit when finalize is active with no passes', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'active';
    d.stages.spec.phases.outline.status = 'done';
    d.stages.spec.phases.craft.status = 'done';
    d.stages.spec.phases.finalize.status = 'active';
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('dispatch_audit');
    expect(action.stage).toBe('spec');
  });

  it('applies findings after revised audit pass', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'active';
    d.stages.spec.phases.finalize.status = 'active';
    d.stages.spec.phases.finalize.auditPasses = [{
      passNo: 1,
      status: 'revised',
      audit: { attempts: [{ batchId: 'a1', status: 'done', at: '2026-07-01T00:00:00Z' }] },
    }];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('apply_findings');
  });

  it('approves spec after clean or cap reached', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'active';
    d.stages.spec.phases.finalize.status = 'active';
    d.stages.spec.phases.finalize.auditPasses = [
      { passNo: 1, status: 'clean', audit: { attempts: [{ batchId: 'a1', status: 'done', at: '' }] } },
    ];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('approve_stage');
  });

  it('dispatches plan author when refine has no file', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'active';
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('dispatch_plan_author');
  });

  it('validates first unapproved task', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'active';
    d.stages.plan.phases.refine.file = 'plan.md';
    d.stages.plan.phases.refine.tasks = [
      { id: 't1', title: 'Task 1', status: 'pending', approvals: [], attempts: [], reviewPolicy: 'reviewed' },
      { id: 't2', title: 'Task 2', status: 'pending', approvals: [], attempts: [], reviewPolicy: 'reviewed' },
    ];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('validate_task');
    expect(action.data?.taskId).toBe('t1');
  });

  it('approves task after validation attempt done', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'active';
    d.stages.plan.phases.refine.file = 'plan.md';
    d.stages.plan.phases.refine.tasks = [
      { id: 't1', title: 'Task 1', status: 'pending', approvals: [],
        attempts: [{ batchId: 'r1', status: 'done', at: '' }], reviewPolicy: 'reviewed' },
    ];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('approve_task');
  });

  it('dispatches harvest when journal is active', () => {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan', 'execute', 'review'] as const) {
      d.stages[k].status = 'done';
    }
    d.stages.journal.status = 'active';
    d.stages.journal.phases.journal.status = 'active';
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('dispatch_harvest');
  });

  it('approves individual learnings', () => {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan', 'execute', 'review'] as const) {
      d.stages[k].status = 'done';
    }
    d.stages.journal.status = 'active';
    d.stages.journal.phases.journal.status = 'active';
    d.stages.journal.phases.journal.attempts = [{ batchId: 'h1', status: 'done', at: '' }];
    d.stages.journal.phases.journal.learnings = [
      { heading: 'L1', type: 'decision', status: 'proposed' },
      { heading: 'L2', type: 'insight', status: 'proposed' },
    ];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('approve_learning');
    expect(action.data?.learningIndex).toBe(0);
  });

  it('marks complete after all learnings recorded', () => {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan', 'execute', 'review'] as const) {
      d.stages[k].status = 'done';
    }
    d.stages.journal.status = 'active';
    d.stages.journal.phases.journal.status = 'active';
    d.stages.journal.phases.journal.attempts = [{ batchId: 'h1', status: 'done', at: '' }];
    d.stages.journal.phases.journal.learnings = [
      { heading: 'L1', type: 'decision', status: 'recorded' },
    ];
    d.stages.journal.phases.summary.attempts = [{ batchId: 'r1', status: 'done', at: '' }];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('mark_complete');
  });

  it('waits when an attempt is running', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'active';
    d.stages.spec.phases.finalize.status = 'active';
    d.stages.spec.phases.finalize.auditPasses = [{
      passNo: 1,
      status: 'revised',
      audit: { attempts: [{ batchId: 'a1', status: 'running', at: '' }] },
    }];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('wait');
  });
});
