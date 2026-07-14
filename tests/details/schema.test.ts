import { describe, it, expect } from 'vitest';
import {
  validateDetails,
  type Details,
  buildInitialDetails,
  buildSubsetDetails,
} from '@/details/schema';

describe('validateDetails', () => {
  it('accepts a valid initial (empty) details', () => {
    const initial = buildInitialDetails();
    const result = validateDetails(initial);
    expect(result.automation.status).toBe('off');
    expect(result.repos).toEqual([]);
    expect(result.stages.exploration.status).toBe('active');
    expect(result.stages.spec.status).toBe('pending');
  });

  it('accepts skipped stage status on subset projects', () => {
    const subset = buildSubsetDetails({
      selectedDesignStages: ['spec', 'plan'],
      uploadedExplorationFile: '/tmp/exploration.md',
    });
    const result = validateDetails(subset);
    expect(result.stages.exploration.status).toBe('done');
    expect(result.stages.execute.status).toBe('skipped');
    expect(result.stages.review.status).toBe('skipped');
    expect(result.stages.journal.status).toBe('pending');
  });

  it('accepts a completed project details', () => {
    const completed: Details = {
      automation: { status: 'off' },
      repos: [{ id: 'r1', name: 'repo', pathOnDisk: '/tmp/repo', defaultBranch: 'main' }],
      stages: {
        exploration: {
          status: 'done', startedAt: '2026-07-01T00:00:00Z', completedAt: '2026-07-01T01:00:00Z',
          phases: {
            brief: { status: 'done', text: 'test brief' },
            discover: { status: 'done', attempts: [], tasks: [] },
            synthesize: { status: 'done', file: 'exploration.md', attempts: [{ batchId: 'b1', status: 'done', at: '2026-07-01T01:00:00Z' }] },
          },
        },
        spec: {
          status: 'done', startedAt: '2026-07-01T01:00:00Z', completedAt: '2026-07-01T02:00:00Z',
          participants: ['m1'],
          phases: {
            outline: { status: 'done', selectedTemplateIds: ['t1'] },
            craft: { status: 'done', file: 'spec.md', components: [], attempts: [] },
            finalize: { status: 'done', auditPasses: [], approvals: ['m1'] },
          },
        },
        plan: {
          status: 'done', startedAt: '2026-07-01T02:00:00Z', completedAt: '2026-07-01T03:00:00Z',
          participants: ['m1'],
          phases: {
            refine: { status: 'done', file: 'plan.md', tasks: [], attempts: [] },
            validate: { status: 'done', auditPasses: [] },
          },
        },
        execute: {
          status: 'skipped',
          phases: {
            configure: { status: 'pending', repos: [] },
            implement: { status: 'pending', repos: [] },
          },
        },
        review: {
          status: 'skipped',
          phases: { review: { status: 'pending', repos: [] } },
        },
        journal: {
          status: 'done', startedAt: '2026-07-01T05:00:00Z', completedAt: '2026-07-01T06:00:00Z',
          participants: ['m1'],
          phases: {
            journal: { status: 'done', file: 'journal.md', attempts: [], learnings: [] },
            summary: { status: 'done', attempts: [] },
          },
        },
      },
    };
    const result = validateDetails(completed);
    expect(result.stages.execute.status).toBe('skipped');
  });

  it('rejects invalid automation status', () => {
    const bad = buildInitialDetails();
    (bad as any).automation.status = 'invalid';
    expect(() => validateDetails(bad)).toThrow();
  });

  it('rejects missing stages', () => {
    const bad = buildInitialDetails();
    delete (bad as any).stages.spec;
    expect(() => validateDetails(bad)).toThrow();
  });

  it('accepts attempt with running status', () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.discover.attempts = [
      { batchId: 'b1', status: 'running', at: '2026-07-01T00:00:00Z' },
    ];
    const result = validateDetails(d);
    expect(result.stages.exploration.phases.discover.attempts[0].status).toBe('running');
  });

  it('accepts component with empty approvals', () => {
    const d = buildInitialDetails();
    d.stages.spec.phases.craft.components = [
      { id: 'comp-1', templateId: 't1', approvals: [] },
    ];
    d.stages.spec.status = 'active';
    const result = validateDetails(d);
    expect(result.stages.spec.phases.craft.components[0].approvals).toEqual([]);
  });

  it('accepts plan task with approvals array of member IDs', () => {
    const d = buildInitialDetails();
    d.stages.plan.phases.refine.tasks = [
      { id: 'task-1', title: 'Task 1', status: 'approved', approvals: ['m1', 'm2'], attempts: [], reviewPolicy: 'reviewed' },
    ];
    d.stages.plan.status = 'active';
    const result = validateDetails(d);
    expect(result.stages.plan.phases.refine.tasks[0].approvals).toEqual(['m1', 'm2']);
  });

  it('accepts audit pass with audit + fix attempts', () => {
    const d = buildInitialDetails();
    d.stages.spec.phases.finalize.auditPasses = [{
      passNo: 1,
      status: 'revised',
      appliedIndexes: [0, 1, 2],
      audit: { attempts: [{ batchId: 'a1', status: 'done', at: '2026-07-01T00:00:00Z' }] },
      fix: { attempts: [{ batchId: 'f1', status: 'done', at: '2026-07-01T00:01:00Z' }] },
    }];
    const result = validateDetails(d);
    expect(result.stages.spec.phases.finalize.auditPasses[0].audit!.attempts).toHaveLength(1);
  });

  it('accepts review pass per repo', () => {
    const d = buildInitialDetails();
    d.stages.review.phases.review.repos = [{
      repoId: 'r1',
      reviewPasses: [{
        passNo: 1,
        status: 'revised',
        review: { attempts: [{ batchId: 'rv1', status: 'done', at: '2026-07-01T00:00:00Z' }] },
        fix: { attempts: [{ batchId: 'rf1', status: 'done', at: '2026-07-01T00:01:00Z' }] },
      }],
    }];
    const result = validateDetails(d);
    expect(result.stages.review.phases.review.repos[0].reviewPasses).toHaveLength(1);
  });

  it('accepts learning with heading and type', () => {
    const d = buildInitialDetails();
    d.stages.journal.phases.journal.learnings = [
      { heading: 'When you do X', type: 'decision', status: 'recorded' },
      { heading: 'Always Y', type: 'insight', status: 'kept' },
    ];
    const result = validateDetails(d);
    expect(result.stages.journal.phases.journal.learnings).toHaveLength(2);
  });
});

describe('buildInitialDetails', () => {
  it('creates valid initial state with exploration active', () => {
    const d = buildInitialDetails();
    expect(d.automation).toEqual({ status: 'off' });
    expect(d.repos).toEqual([]);
    expect(d.stages.exploration.status).toBe('active');
    expect(d.stages.spec.status).toBe('pending');
    expect(d.stages.plan.status).toBe('pending');
    expect(d.stages.execute.status).toBe('pending');
    expect(d.stages.review.status).toBe('pending');
    expect(d.stages.journal.status).toBe('pending');
  });

  it('validates through the Zod schema', () => {
    const d = buildInitialDetails();
    expect(() => validateDetails(d)).not.toThrow();
  });
});

describe('buildSubsetDetails', () => {
  it('seeds a spec-plan subset from an uploaded exploration artifact', () => {
    const d = buildSubsetDetails({
      selectedDesignStages: ['spec', 'plan'],
      uploadedExplorationFile: '/tmp/exploration.md',
    });
    expect(d.stages.exploration.status).toBe('done');
    expect(d.stages.exploration.phases.synthesize.file).toBe('/tmp/exploration.md');
    expect(d.stages.spec.status).toBe('active');
    expect(d.stages.plan.status).toBe('pending');
    expect(d.stages.execute.status).toBe('skipped');
    expect(d.stages.review.status).toBe('skipped');
    expect(d.stages.journal.status).toBe('pending');
  });

  it('seeds a plan-only subset from uploaded spec proof', () => {
    const d = buildSubsetDetails({
      selectedDesignStages: ['plan'],
      uploadedSpec: {
        filePath: '/tmp/spec.md',
        selectedTemplateIds: ['tpl-context', 'tpl-problem'],
        components: [
          { id: 'comp-context', templateId: 'tpl-context', approvals: [] },
          { id: 'comp-problem', templateId: 'tpl-problem', approvals: [] },
        ],
      },
      forgeApprovalMemberId: '00000000-0000-0000-0000-000000000000',
    });
    expect(d.stages.exploration.status).toBe('skipped');
    expect(d.stages.spec.status).toBe('done');
    expect(d.stages.spec.phases.outline.selectedTemplateIds).toEqual(['tpl-context', 'tpl-problem']);
    expect(d.stages.spec.phases.finalize.approvals).toEqual(['00000000-0000-0000-0000-000000000000']);
    expect(d.stages.plan.status).toBe('active');
    expect(d.stages.execute.status).toBe('skipped');
    expect(d.stages.review.status).toBe('skipped');
    expect(d.stages.journal.status).toBe('pending');
  });
});
