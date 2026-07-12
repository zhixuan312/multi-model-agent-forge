import { describe, it, expect } from 'vitest';
import { buildInitialDetails, validateDetails, type Details } from '@/details/schema';
import { resolveNextActionFromDetails } from '@/automation/details-resolver';
import {
  recordAuthorAttempt, recordTaskValidation,
  recordExecuteAttempt, recordImplementAttempt, openRunningAttempts,
  recordAuditPass, recordReviewPass, recordReviewFix, recordHarvestAttempt,
  reopenStageInPlace,
} from '@/automation/details-mutations';

const AT = '2026-07-04T00:00:00.000Z';

/**
 * Action-effect coverage (AC2): each mutator must record EXACTLY the gating state
 * the resolver reads. Every test both asserts the shape AND drives the resolver
 * to prove the transition it unblocks — so a regression that stops writing the
 * gate is caught as a stalled resolver, not just a shape diff.
 */
describe('details-mutations — record the resolver gating state', () => {
  function planRefineActive() {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'active';
    d.stages.plan.phases.refine.file = 'plan.md';
    return d;
  }

  it('recordAuthorAttempt → running refine attempt → resolver WAITs', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'active';
    recordAuthorAttempt(d, 'b1', AT);
    expect(d.stages.plan.phases.refine.attempts).toEqual([{ batchId: 'b1', status: 'running', at: AT }]);
    expect(validateDetails(d)).toBeTruthy();
    expect(resolveNextActionFromDetails(d).kind).toBe('wait');
  });

  it('a flipped (failed) plan-author attempt → resolver re-dispatches', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'active';
    d.repos = [{ id: 'r1', name: 'forge', pathOnDisk: '/tmp/forge', defaultBranch: 'main' }];
    recordAuthorAttempt(d, 'b1', AT);
    // the centralized reconcile flips a stuck running attempt to failed
    d.stages.plan.phases.refine.attempts.at(-1)!.status = 'failed';
    expect(resolveNextActionFromDetails(d).kind).toBe('dispatch_plan_author');
  });

  it('recordTaskValidation → done task attempt → resolver approves the task', () => {
    const d = planRefineActive();
    d.stages.plan.phases.refine.tasks = [
      { id: 't1', title: 'T1', status: 'pending', approvals: [], attempts: [], reviewPolicy: 'reviewed' },
    ];
    recordTaskValidation(d, 't1', 'r1', AT);
    expect(d.stages.plan.phases.refine.tasks[0].attempts).toEqual([{ batchId: 'r1', status: 'done', at: AT }]);
    expect(resolveNextActionFromDetails(d).kind).toBe('approve_task');
  });

  function executeActive() {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan'] as const) d.stages[k].status = 'done';
    d.stages.execute.status = 'active';
    d.stages.plan.phases.refine.tasks = [
      { id: 't1', title: 'T1', status: 'approved', approvals: ['m'], attempts: [], reviewPolicy: 'reviewed' },
    ];
    return d;
  }

  it('recordExecuteAttempt → running attempt → resolver WAITs (no duplicate dispatch)', () => {
    const d = executeActive();
    recordExecuteAttempt(d, 'repo-1', 'e1', AT);
    expect(d.stages.execute.phases.implement.repos).toEqual([
      { repoId: 'repo-1', attempts: [{ batchId: 'e1', status: 'running', at: AT }] },
    ]);
    expect(resolveNextActionFromDetails(d).kind).toBe('wait');
  });

  it('recordImplementAttempt FLIPS the running attempt to done (no 2nd attempt) → advance to Review', () => {
    const d = executeActive();
    recordExecuteAttempt(d, 'repo-1', 'e1', AT);
    recordImplementAttempt(d, 'repo-1', 'e1', AT);
    expect(d.stages.execute.phases.implement.repos[0].attempts).toEqual([
      { batchId: 'e1', status: 'done', at: AT },
    ]);
    expect(d.stages.plan.phases.refine.tasks[0].status).toBe('committed');
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('advance_stage');
    expect(action.stage).toBe('review');
  });

  it('a flipped (failed) execute attempt → resolver re-dispatches (retry)', () => {
    const d = executeActive();
    recordExecuteAttempt(d, 'repo-1', 'e1', AT);
    // the centralized reconcile flips a stuck running attempt to failed
    d.stages.execute.phases.implement.repos[0].attempts.at(-1)!.status = 'failed';
    expect(resolveNextActionFromDetails(d).kind).toBe('dispatch_execute');
  });

  it('openRunningAttempts (central reconcile source) reports every open async attempt', () => {
    const d = executeActive();
    // no open attempts yet
    expect(openRunningAttempts(d)).toEqual([]);
    // a running execute attempt is surfaced with its stage/phase/label + live ref
    recordExecuteAttempt(d, 'repo-1', 'e1', AT);
    const open = openRunningAttempts(d);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ stage: 'execute', phase: 'implement', label: 'Execution' });
    expect(open[0].attempt.batchId).toBe('e1');
    // flipping via the returned reference mutates details in place
    open[0].attempt.status = 'failed';
    expect(d.stages.execute.phases.implement.repos[0].attempts[0].status).toBe('failed');
    // and a done execute attempt is NOT reported as open
    expect(openRunningAttempts(d)).toEqual([]);
  });

  it('openRunningAttempts excludes a plan-author attempt once refine.file is set (handler closed it)', () => {
    const d = buildInitialDetails();
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'active';
    recordAuthorAttempt(d, 'b1', AT);
    expect(openRunningAttempts(d).map((x) => x.label)).toEqual(['Plan author']);
    d.stages.plan.phases.refine.file = 'plan.md'; // handler success signal
    expect(openRunningAttempts(d)).toEqual([]);
  });

  it('recordImplementAttempt falls back to a done attempt when none is running (manual path)', () => {
    const d = executeActive();
    recordImplementAttempt(d, 'repo-1', 'e1', AT);
    expect(d.stages.execute.phases.implement.repos[0].attempts).toEqual([
      { batchId: 'e1', status: 'done', at: AT },
    ]);
    expect(resolveNextActionFromDetails(d).kind).toBe('advance_stage');
  });

  it('recordReviewPass(clean) → resolver advances to Journal', () => {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan', 'execute'] as const) d.stages[k].status = 'done';
    d.stages.review.status = 'active';
    recordReviewPass(d, 'repo-1', 'v1', false, AT, null);
    const pass = d.stages.review.phases.review.repos[0].reviewPasses[0];
    expect(pass).toMatchObject({ passNo: 1, status: 'clean' });
    expect(pass.review!.attempts).toEqual([{ batchId: 'v1', status: 'done', at: AT, contextBlockId: null }]);
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('advance_stage');
    expect(action.stage).toBe('journal');
  });

  it('recordReviewPass(blocking) → revised pass → resolver applies review findings', () => {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan', 'execute'] as const) d.stages[k].status = 'done';
    d.stages.review.status = 'active';
    recordReviewPass(d, 'repo-1', 'v1', true, AT, null);
    expect(d.stages.review.phases.review.repos[0].reviewPasses[0].status).toBe('revised');
    expect(resolveNextActionFromDetails(d).kind).toBe('apply_review_findings');
  });

  it('recordReviewFix → next review pass; passNo increments across passes', () => {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan', 'execute'] as const) d.stages[k].status = 'done';
    d.stages.review.status = 'active';
    recordReviewPass(d, 'repo-1', 'v1', true, AT, null);
    recordReviewFix(d, 'repo-1', 'f1', AT);
    expect(d.stages.review.phases.review.repos[0].reviewPasses[0].fix!.attempts).toEqual([{ batchId: 'f1', status: 'done', at: AT }]);
    expect(resolveNextActionFromDetails(d).kind).toBe('dispatch_review');
    recordReviewPass(d, 'repo-1', 'v2', false, AT, null);
    expect(d.stages.review.phases.review.repos[0].reviewPasses.map((p) => p.passNo)).toEqual([1, 2]);
  });

  it('recordHarvestAttempt → done journal attempt → resolver moves to approving learnings', () => {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan', 'execute', 'review'] as const) d.stages[k].status = 'done';
    d.stages.journal.status = 'active';
    d.stages.journal.phases.journal.status = 'active';
    d.stages.journal.phases.journal.learnings = [{ heading: 'L1', type: 'insight', status: 'proposed' }];
    recordHarvestAttempt(d, 'h1', AT);
    expect(d.stages.journal.phases.journal.attempts).toEqual([{ batchId: 'h1', status: 'done', at: AT }]);
    expect(resolveNextActionFromDetails(d).kind).toBe('approve_learning');
  });
});

/**
 * `reopenStageInPlace` is the completion-invariant recovery: reset a skipped stage
 * + everything after it, re-activate the target. Guards against a false "complete".
 */
describe('reopenStageInPlace — reopen a skipped stage', () => {
  function fullyDone(): Details {
    const d = buildInitialDetails();
    for (const stg of Object.values(d.stages)) {
      stg.status = 'done';
      for (const ph of Object.values(stg.phases as Record<string, { status: string }>)) ph.status = 'done';
    }
    // give spec + plan real work so they survive a downstream reopen unchanged
    d.stages.spec.phases.finalize.approvals = ['m1'];
    d.stages.plan.phases.refine.tasks = [{ id: 't1', title: 'T1', status: 'committed', approvals: ['m1'], attempts: [], reviewPolicy: 'reviewed' }];
    d.stages.execute.phases.implement.repos = [{ repoId: 'r1', attempts: [{ batchId: 'e1', status: 'done', at: AT }] }];
    return d;
  }

  it('reopens Execute: execute active+empty, review/journal reset pending, spec/plan untouched', () => {
    const d = fullyDone();
    reopenStageInPlace(d, 'execute', AT);
    expect(d.stages.execute.status).toBe('active');
    expect(d.stages.execute.phases.implement.repos).toEqual([]); // cleared → resolver re-dispatches
    expect(d.stages.review.status).toBe('pending');
    expect(d.stages.journal.status).toBe('pending');
    // upstream stages keep their recorded work
    expect(d.stages.spec.phases.finalize.approvals).toEqual(['m1']);
    expect(d.stages.plan.phases.refine.tasks).toHaveLength(1);
  });

  it('reopens Plan: plan active at refine, execute/review/journal reset, spec untouched', () => {
    const d = fullyDone();
    reopenStageInPlace(d, 'plan', AT);
    expect(d.stages.plan.status).toBe('active');
    expect(d.stages.plan.phases.refine.status).toBe('active');
    expect(d.stages.plan.phases.refine.tasks).toEqual([]); // reset to clean template
    expect(d.stages.execute.status).toBe('pending');
    expect(d.stages.review.status).toBe('pending');
    expect(d.stages.spec.phases.finalize.approvals).toEqual(['m1']); // upstream preserved
  });
});

describe('recordAuditPass', () => {
  it('pushes a spec finalize pass carrying the audit attempt block id', () => {
    const d = recordAuditPass(buildInitialDetails(), 'spec', 1, 'clean', 'batch-1', '2026-07-06T00:00:00Z', 'B1');
    const p = d.stages.spec.phases.finalize.auditPasses[0];
    expect(p.passNo).toBe(1);
    expect(p.status).toBe('clean');
    expect(p.audit!.attempts[0]).toMatchObject({ batchId: 'batch-1', status: 'done', contextBlockId: 'B1' });
  });
  it('stores a null block id on the plan validate pass when MMA returned none', () => {
    const d = recordAuditPass(buildInitialDetails(), 'plan', 2, 'revised', 'batch-2', '2026-07-06T00:00:00Z', null);
    expect(d.stages.plan.phases.validate.auditPasses[0].audit!.attempts[0].contextBlockId).toBeNull();
  });
});

describe('recordReviewPass — context block id', () => {
  it('persists the review result block id on the per-repo review attempt', () => {
    const d = recordReviewPass(buildInitialDetails(), 'r1', 'batch-9', false, '2026-07-06T00:00:00Z', 'RB1');
    const entry = d.stages.review.phases.review.repos.find((x) => x.repoId === 'r1')!;
    expect(entry.reviewPasses[0].review!.attempts[0]).toMatchObject({ batchId: 'batch-9', contextBlockId: 'RB1' });
  });
  it('accepts a null block id (MMA returned none)', () => {
    const d = recordReviewPass(buildInitialDetails(), 'r1', 'batch-9', true, '2026-07-06T00:00:00Z', null);
    const entry = d.stages.review.phases.review.repos.find((x) => x.repoId === 'r1')!;
    expect(entry.reviewPasses[0].review!.attempts[0].contextBlockId).toBeNull();
  });
});
