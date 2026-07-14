import { describe, it, expect } from 'vitest';
import { buildInitialDetails, buildSubsetDetails, type Details } from '@/details/schema';
import { firstUnderdoneStage, resolveNextActionFromDetails } from '@/automation/details-resolver';

/** Populate the DEFINING work record of every stage — the proof each ran. Without
 * these, the completion invariant treats a status-only "done" as a skipped stage. */
function withAllStageWork(d: Details): Details {
  d.stages.exploration.phases.synthesize.file = 'exploration.md';
  d.stages.spec.phases.finalize.approvals = ['m1'];
  d.stages.plan.phases.refine.tasks = [{ id: 't1', title: 'T1', status: 'committed', approvals: ['m1'], attempts: [], reviewPolicy: 'reviewed' }];
  d.stages.plan.phases.validate.auditPasses = [{ passNo: 1, status: 'clean' }];
  d.stages.execute.phases.implement.repos = [{ repoId: 'r1', attempts: [{ batchId: 'e1', status: 'done', at: '' }] }];
  d.stages.review.phases.review.repos = [{ repoId: 'r1', reviewPasses: [{ passNo: 1, status: 'clean', review: { attempts: [{ batchId: 'v1', status: 'done', at: '' }] } }] }];
  d.stages.journal.phases.journal.attempts = [{ batchId: 'h1', status: 'done', at: '' }];
  return d;
}

describe('resolveNextActionFromDetails', () => {
  it('returns complete for a fully done project (with real work recorded)', () => {
    const d = withAllStageWork(buildInitialDetails());
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
    d.repos = [{ id: 'r1', name: 'forge', pathOnDisk: '/tmp/forge', defaultBranch: 'main' }];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('dispatch_plan_author');
  });

  it('WAITs (does not dispatch plan author) when no repository is linked', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'active';
    d.repos = []; // no linked repo → plan authoring would hard-fail
    expect(resolveNextActionFromDetails(d).kind).toBe('wait');
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

  it('marks complete after all learnings recorded (all stages did real work)', () => {
    const d = withAllStageWork(buildInitialDetails());
    for (const k of ['exploration', 'spec', 'plan', 'execute', 'review'] as const) {
      d.stages[k].status = 'done';
    }
    d.stages.journal.status = 'active';
    d.stages.journal.phases.journal.status = 'active';
    d.stages.journal.phases.journal.learnings = [
      { heading: 'L1', type: 'decision', status: 'recorded' },
    ];
    d.stages.journal.phases.summary.attempts = [{ batchId: 'r1', status: 'done', at: '' }];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('mark_complete');
  });

  describe('completion invariant — never complete on a skipped stage', () => {
    /** journal active, learnings recorded — the moment before mark_complete. */
    function atCompletionBoundary(): Details {
      const d = withAllStageWork(buildInitialDetails());
      for (const k of ['exploration', 'spec', 'plan', 'execute', 'review'] as const) d.stages[k].status = 'done';
      d.stages.journal.status = 'active';
      d.stages.journal.phases.journal.status = 'active';
      d.stages.journal.phases.journal.learnings = [{ heading: 'L1', type: 'decision', status: 'recorded' }];
      d.stages.journal.phases.summary.attempts = [{ batchId: 'r1', status: 'done', at: '' }];
      return d;
    }

    it('reopens Execute when it was marked done but committed nothing', () => {
      const d = atCompletionBoundary();
      d.stages.execute.phases.implement.repos = []; // the skip: no execute work
      const action = resolveNextActionFromDetails(d);
      expect(action.kind).toBe('reopen_stage');
      expect(action.stage).toBe('execute');
    });

    it('reopens Review when it was marked done but ran no pass', () => {
      const d = atCompletionBoundary();
      d.stages.review.phases.review.repos = []; // the skip: no review work
      const action = resolveNextActionFromDetails(d);
      expect(action.kind).toBe('reopen_stage');
      expect(action.stage).toBe('review');
    });

    it('reopens the EARLIEST skipped stage first (plan audit skipped)', () => {
      const d = atCompletionBoundary();
      d.stages.plan.phases.validate.auditPasses = []; // plan skipped (earlier than execute/review)
      d.stages.execute.phases.implement.repos = [];
      const action = resolveNextActionFromDetails(d);
      expect(action.kind).toBe('reopen_stage');
      expect(action.stage).toBe('plan');
    });

    it('reopens even from a fully "done" corrupted state (all statuses done, no work)', () => {
      const d = buildInitialDetails();
      for (const stg of Object.values(d.stages)) {
        stg.status = 'done';
        for (const ph of Object.values(stg.phases as Record<string, { status: string }>)) ph.status = 'done';
      }
      // synthesize "done" but no other work → earliest skip is spec (not approved)
      const action = resolveNextActionFromDetails(d);
      expect(action.kind).toBe('reopen_stage');
      expect(action.stage).toBe('spec');
    });

    it('WAITs (never reopens/wipes) when an UNDRIVEABLE stage is active — exploration', () => {
      // auto-mode does not drive Design (exploration / spec craft). The old bottom
      // fallthrough returned reopen_stage → reopenStageInPlace wipes all stages →
      // infinite loop + data loss. It must WAIT instead.
      const d = buildInitialDetails(); // exploration active, nothing else done
      expect(resolveNextActionFromDetails(d).kind).toBe('wait');
    });

    it('WAITs when spec craft is active (Design stage, not auto-driven)', () => {
      const d = buildInitialDetails();
      d.stages.exploration.status = 'done';
      d.stages.spec.status = 'active';
      d.stages.spec.phases.outline.status = 'done';
      d.stages.spec.phases.craft.status = 'active'; // craft is manual — no resolver branch
      expect(resolveNextActionFromDetails(d).kind).toBe('wait');
    });
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

/**
 * Full-pipeline transition coverage (AC1). Every state the driver can be in must
 * resolve to a defined next action so the run never stalls. These lock the exact
 * transitions the four previously-dormant stages (tasks / execute / review /
 * journal) depend on — each is only reachable if its action records the gating
 * state the resolver reads (verified separately by the action-effect tests).
 */
describe('resolveNextActionFromDetails — full pipeline', () => {
  /** A project parked with everything before `plan` done and plan active. */
  function planActive() {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'active';
    d.stages.plan.phases.refine.file = 'plan.md';
    return d;
  }

  it('advances to plan-validate once all tasks are approved', () => {
    const d = planActive();
    d.stages.plan.phases.refine.tasks = [
      { id: 't1', title: 'T1', status: 'approved', approvals: ['m1'], attempts: [{ batchId: 'r', status: 'done', at: '' }], reviewPolicy: 'reviewed' },
    ];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('advance_phase');
    expect(action.stage).toBe('plan');
    expect(action.phase).toBe('validate');
  });

  it('dispatches plan audit when validate is active with no passes', () => {
    const d = planActive();
    d.stages.plan.phases.refine.status = 'done';
    d.stages.plan.phases.validate.status = 'active';
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('dispatch_audit');
    expect(action.stage).toBe('plan');
  });

  it('applies plan-audit findings after a revised pass', () => {
    const d = planActive();
    d.stages.plan.phases.refine.status = 'done';
    d.stages.plan.phases.validate.status = 'active';
    d.stages.plan.phases.validate.auditPasses = [
      { passNo: 1, status: 'revised', audit: { attempts: [{ batchId: 'a1', status: 'done', at: '' }] } },
    ];
    expect(resolveNextActionFromDetails(d).kind).toBe('apply_findings');
  });

  it('approves plan (→ execute) after a clean plan audit', () => {
    const d = planActive();
    d.stages.plan.phases.refine.status = 'done';
    d.stages.plan.phases.validate.status = 'active';
    d.stages.plan.phases.validate.auditPasses = [
      { passNo: 1, status: 'clean', audit: { attempts: [{ batchId: 'a1', status: 'done', at: '' }] } },
    ];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('approve_stage');
    expect(action.stage).toBe('plan');
  });

  /** Everything up to execute done, execute active. */
  function executeActive() {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan'] as const) d.stages[k].status = 'done';
    d.stages.execute.status = 'active';
    return d;
  }

  it('dispatches execution when no repo has an implement attempt', () => {
    const d = executeActive();
    expect(resolveNextActionFromDetails(d).kind).toBe('dispatch_execute');
  });

  it('waits while an execute attempt is running', () => {
    const d = executeActive();
    d.stages.execute.phases.implement.repos = [
      { repoId: 'r1', attempts: [{ batchId: 'e1', status: 'running', at: '' }] },
    ];
    expect(resolveNextActionFromDetails(d).kind).toBe('wait');
  });

  it('advances execute → review once the implement attempt is done', () => {
    const d = executeActive();
    d.stages.execute.phases.implement.repos = [
      { repoId: 'r1', attempts: [{ batchId: 'e1', status: 'done', at: '' }] },
    ];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('advance_stage');
    expect(action.stage).toBe('review');
  });

  /** Everything up to review done, review active. */
  function reviewActive() {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan', 'execute'] as const) d.stages[k].status = 'done';
    d.stages.review.status = 'active';
    return d;
  }

  it('dispatches code review when no repo has a review pass', () => {
    const d = reviewActive();
    expect(resolveNextActionFromDetails(d).kind).toBe('dispatch_review');
  });

  it('waits while a review pass is running', () => {
    const d = reviewActive();
    d.stages.review.phases.review.repos = [
      { repoId: 'r1', reviewPasses: [{ passNo: 1, status: 'revised', review: { attempts: [{ batchId: 'v1', status: 'running', at: '' }] } }] },
    ];
    expect(resolveNextActionFromDetails(d).kind).toBe('wait');
  });

  it('applies review findings after a revised pass with no fix yet', () => {
    const d = reviewActive();
    d.stages.review.phases.review.repos = [
      { repoId: 'r1', reviewPasses: [{ passNo: 1, status: 'revised', review: { attempts: [{ batchId: 'v1', status: 'done', at: '' }] } }] },
    ];
    expect(resolveNextActionFromDetails(d).kind).toBe('apply_review_findings');
  });

  it('runs another review pass after the fix is applied (< 5 passes)', () => {
    const d = reviewActive();
    d.stages.review.phases.review.repos = [
      { repoId: 'r1', reviewPasses: [{ passNo: 1, status: 'revised', review: { attempts: [{ batchId: 'v1', status: 'done', at: '' }] }, fix: { attempts: [{ batchId: 'f1', status: 'done', at: '' }] } }] },
    ];
    expect(resolveNextActionFromDetails(d).kind).toBe('dispatch_review');
  });

  it('advances review → journal once a repo review is clean', () => {
    const d = reviewActive();
    d.stages.review.phases.review.repos = [
      { repoId: 'r1', reviewPasses: [{ passNo: 1, status: 'clean', review: { attempts: [{ batchId: 'v1', status: 'done', at: '' }] } }] },
    ];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('advance_stage');
    expect(action.stage).toBe('journal');
  });

  it('records learnings once they are all approved (kept, not recorded)', () => {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan', 'execute', 'review'] as const) d.stages[k].status = 'done';
    d.stages.journal.status = 'active';
    d.stages.journal.phases.journal.status = 'active';
    d.stages.journal.phases.journal.attempts = [{ batchId: 'h1', status: 'done', at: '' }];
    d.stages.journal.phases.journal.learnings = [
      { heading: 'L1', type: 'decision', status: 'kept' },
    ];
    expect(resolveNextActionFromDetails(d).kind).toBe('dispatch_record');
  });
});

/** Edge-case fixes from the line-by-line review. */
describe('resolver edge-case fixes', () => {
  function withWork(d: import('@/details/schema').Details) {
    d.stages.exploration.phases.synthesize.file = 'exploration.md';
    d.stages.spec.phases.finalize.approvals = ['m1'];
    d.stages.plan.phases.refine.tasks = [{ id: 't1', title: 'T1', status: 'committed', approvals: ['m1'], attempts: [], reviewPolicy: 'reviewed' }];
    d.stages.plan.phases.validate.auditPasses = [{ passNo: 1, status: 'clean' }];
    d.stages.execute.phases.implement.repos = [{ repoId: 'r1', attempts: [{ batchId: 'e1', status: 'done', at: '' }] }];
    return d;
  }

  it('LOW5: bounds plan-author re-dispatch at 5 failed attempts', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'active';
    d.repos = [{ id: 'r1', name: 'forge', pathOnDisk: '/tmp/forge', defaultBranch: 'main' }];
    // 4 failed → still re-dispatches
    d.stages.plan.phases.refine.attempts = Array.from({ length: 4 }, (_, i) => ({ batchId: `b${i}`, status: 'failed' as const, at: '' }));
    expect(resolveNextActionFromDetails(d).kind).toBe('dispatch_plan_author');
    // 5 failed → capped → WAIT (no more burn)
    d.stages.plan.phases.refine.attempts.push({ batchId: 'b5', status: 'failed', at: '' });
    expect(resolveNextActionFromDetails(d).kind).toBe('wait');
  });

  it('LOW7: journal completes when a learning is `removed` (no dispatch_record deadlock)', () => {
    const d = withWork(buildInitialDetails());
    for (const k of ['exploration', 'spec', 'plan', 'execute', 'review'] as const) d.stages[k].status = 'done';
    d.stages.review.phases.review.repos = [{ repoId: 'r1', reviewPasses: [{ passNo: 1, status: 'clean', review: { attempts: [{ batchId: 'v', status: 'done', at: '' }] } }] }];
    d.stages.journal.status = 'active';
    d.stages.journal.phases.journal.status = 'active';
    d.stages.journal.phases.journal.attempts = [{ batchId: 'h1', status: 'done', at: '' }];
    d.stages.journal.phases.journal.learnings = [
      { heading: 'L1', type: 'decision', status: 'recorded' },
      { heading: 'L2', type: 'insight', status: 'removed' }, // human removed one
    ];
    d.stages.journal.phases.summary.attempts = [{ batchId: 'r1', status: 'done', at: '' }];
    // NOT dispatch_record (would loop forever on the removed one) → mark_complete
    expect(resolveNextActionFromDetails(d).kind).toBe('mark_complete');
  });

  it('MED4: multi-repo review acts on the BLOCKING repo at index>0, not just repos[0]', () => {
    const d = withWork(buildInitialDetails());
    for (const k of ['exploration', 'spec', 'plan', 'execute'] as const) d.stages[k].status = 'done';
    d.stages.review.status = 'active';
    d.stages.review.phases.review.repos = [
      { repoId: 'r0', reviewPasses: [{ passNo: 1, status: 'clean', review: { attempts: [{ batchId: 'v0', status: 'done', at: '' }] } }] },
      { repoId: 'r1', reviewPasses: [{ passNo: 1, status: 'revised', review: { attempts: [{ batchId: 'v1', status: 'done', at: '' }] } }] }, // blocking
    ];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('apply_review_findings'); // NOT advance_stage
    expect(action.data?.repoId).toBe('r1');
  });
});

function withSubsetJournalBoundary(): Details {
  const d = buildSubsetDetails({
    selectedDesignStages: ['spec', 'plan'],
    uploadedExplorationFile: '/tmp/exploration.md',
  });
  d.stages.spec.status = 'done';
  d.stages.spec.phases.finalize.approvals = ['m1'];
  d.stages.plan.status = 'done';
  d.stages.plan.phases.refine.tasks = [{ id: 't1', title: 'Task 1', status: 'committed', approvals: ['m1'], attempts: [], reviewPolicy: 'reviewed' }];
  d.stages.plan.phases.validate.auditPasses = [{ passNo: 1, status: 'clean' }];
  d.stages.journal.status = 'active';
  d.stages.journal.phases.journal.status = 'active';
  d.stages.journal.phases.journal.attempts = [{ batchId: 'h1', status: 'done', at: '' }];
  d.stages.journal.phases.journal.learnings = [{ heading: 'L1', type: 'decision', status: 'recorded' }];
  d.stages.journal.phases.summary.attempts = [{ batchId: 'r1', status: 'done', at: '' }];
  return d;
}

describe('firstUnderdoneStage', () => {
  it('ignores skipped execute/review on subset projects', () => {
    const d = withSubsetJournalBoundary();
    expect(firstUnderdoneStage(d)).toBeNull();
  });
});

describe('resolveNextActionFromDetails', () => {
  it('marks a subset project complete once all in-scope stages are done and execute/review are skipped', () => {
    const d = withSubsetJournalBoundary();
    expect(resolveNextActionFromDetails(d).kind).toBe('mark_complete');
  });

  it('advances from review to journal only through the next non-skipped stage', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'done';
    d.stages.execute.status = 'skipped';
    d.stages.review.status = 'skipped';
    d.stages.journal.status = 'active';
    d.stages.journal.phases.journal.status = 'active';
    expect(resolveNextActionFromDetails(d).kind).toBe('dispatch_harvest');
  });
});
