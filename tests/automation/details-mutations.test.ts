import { describe, it, expect } from 'vitest';
import { buildInitialDetails, validateDetails, type Details } from '@/details/schema';
import { resolveNextActionFromDetails } from '@/automation/details-resolver';
import {
  recordAuthorAttempt, failStuckAuthorAttempt, recordTaskValidation,
  recordImplementAttempt, recordReviewPass, recordReviewFix, recordHarvestAttempt,
  resolveRunningEventInPlace, reopenStageInPlace, passAugmentedDetail,
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

  it('failStuckAuthorAttempt flips running→failed + logs an error step → resolver re-dispatches', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'active';
    recordAuthorAttempt(d, 'b1', AT);
    const flipped = failStuckAuthorAttempt(d, AT);
    expect(flipped).toBe(true);
    expect(d.stages.plan.phases.refine.attempts.at(-1)!.status).toBe('failed');
    expect(d.events.at(-1)).toMatchObject({ kind: 'error', detail: 'Plan author failed — retrying' });
    expect(resolveNextActionFromDetails(d).kind).toBe('dispatch_plan_author');
  });

  it('failStuckAuthorAttempt is a no-op when there is no running attempt', () => {
    const d = planRefineActive();
    expect(failStuckAuthorAttempt(d, AT)).toBe(false);
    expect(d.events).toHaveLength(0);
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

  it('recordImplementAttempt → done repo attempt + tasks committed → resolver advances to Review', () => {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan'] as const) d.stages[k].status = 'done';
    d.stages.execute.status = 'active';
    d.stages.plan.phases.refine.tasks = [
      { id: 't1', title: 'T1', status: 'approved', approvals: ['m'], attempts: [], reviewPolicy: 'reviewed' },
    ];
    recordImplementAttempt(d, 'repo-1', 'e1', AT);
    expect(d.stages.execute.phases.implement.repos).toEqual([
      { repoId: 'repo-1', attempts: [{ batchId: 'e1', status: 'done', at: AT }] },
    ]);
    expect(d.stages.plan.phases.refine.tasks[0].status).toBe('committed');
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('advance_stage');
    expect(action.stage).toBe('review');
  });

  it('recordImplementAttempt appends to an existing repo entry (idempotent find-or-create)', () => {
    const d = buildInitialDetails();
    d.stages.execute.status = 'active';
    recordImplementAttempt(d, 'repo-1', 'e1', AT);
    recordImplementAttempt(d, 'repo-1', 'e2', AT);
    const repos = d.stages.execute.phases.implement.repos;
    expect(repos).toHaveLength(1);
    expect(repos[0].attempts).toHaveLength(2);
  });

  it('recordReviewPass(clean) → resolver advances to Journal', () => {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan', 'execute'] as const) d.stages[k].status = 'done';
    d.stages.review.status = 'active';
    recordReviewPass(d, 'repo-1', 'v1', false, AT);
    const pass = d.stages.review.phases.review.repos[0].reviewPasses[0];
    expect(pass).toMatchObject({ passNo: 1, status: 'clean' });
    expect(pass.review!.attempts).toEqual([{ batchId: 'v1', status: 'done', at: AT }]);
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('advance_stage');
    expect(action.stage).toBe('journal');
  });

  it('recordReviewPass(blocking) → revised pass → resolver applies review findings', () => {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan', 'execute'] as const) d.stages[k].status = 'done';
    d.stages.review.status = 'active';
    recordReviewPass(d, 'repo-1', 'v1', true, AT);
    expect(d.stages.review.phases.review.repos[0].reviewPasses[0].status).toBe('revised');
    expect(resolveNextActionFromDetails(d).kind).toBe('apply_review_findings');
  });

  it('recordReviewFix → next review pass; passNo increments across passes', () => {
    const d = buildInitialDetails();
    for (const k of ['exploration', 'spec', 'plan', 'execute'] as const) d.stages[k].status = 'done';
    d.stages.review.status = 'active';
    recordReviewPass(d, 'repo-1', 'v1', true, AT);
    recordReviewFix(d, 'repo-1', 'f1', AT);
    expect(d.stages.review.phases.review.repos[0].reviewPasses[0].fix!.attempts).toEqual([{ batchId: 'f1', status: 'done', at: AT }]);
    expect(resolveNextActionFromDetails(d).kind).toBe('dispatch_review');
    recordReviewPass(d, 'repo-1', 'v2', false, AT);
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
 * The activity log is "one line per activity": a running `action` line is resolved
 * IN PLACE by its terminal (real duration stamped), never duplicated into a
 * start/finish pair. `resolveRunningEventInPlace` is the pure core of that.
 */
describe('resolveRunningEventInPlace — one line per activity', () => {
  const running = (stage: string, detail: string) => ({ stage, phase: 'p', detail, kind: 'action' as const, at: AT });

  it('resolves the running line in place, preserving the pass number + duration (no new line)', () => {
    const d = buildInitialDetails();
    d.events = [running('spec', 'Running spec audit pass 3')];
    const resolved = resolveRunningEventInPlace(d, { stage: 'spec', phase: 'finalize', detail: 'Audited spec', kind: 'done', durationMs: 192000, at: '2026-07-04T00:05:00.000Z' });
    expect(d.events).toHaveLength(1);
    // pass number carried from the running line so passes stay distinguishable
    expect(d.events[0]).toMatchObject({ kind: 'done', detail: 'Audited spec (pass 3)', durationMs: 192000, at: AT });
    // and the RESOLVED label is returned so the live SSE line shows the number too
    expect(resolved).toBe('Audited spec (pass 3)');
  });

  it('passAugmentedDetail carries the running pass number onto the base label', () => {
    expect(passAugmentedDetail('Running plan audit pass 2', 'Audited plan')).toBe('Audited plan (pass 2)');
    expect(passAugmentedDetail('Authoring plan from spec', 'Authored plan')).toBe('Authored plan'); // no pass → unchanged
    expect(passAugmentedDetail('Running review pass 5', 'Reviewed code — failed')).toBe('Reviewed code — failed (pass 5)');
  });

  it('resolves without a pass suffix when the running line has none', () => {
    const d = buildInitialDetails();
    d.events = [running('journal', 'Harvesting learnings')];
    resolveRunningEventInPlace(d, { stage: 'journal', phase: 'journal', detail: 'Harvested learnings', kind: 'done', durationMs: 4000, at: AT });
    expect(d.events[0]).toMatchObject({ kind: 'done', detail: 'Harvested learnings' });
  });

  it('appends a fresh terminal line when there is no running line to resolve (manual dispatch)', () => {
    const d = buildInitialDetails();
    d.events = [{ stage: 'spec', phase: 'craft', detail: 'Drafted spec', kind: 'done', at: AT }];
    resolveRunningEventInPlace(d, { stage: 'plan', phase: 'refine', detail: 'Authored plan', kind: 'done', durationMs: 5000, at: '2026-07-04T00:10:00.000Z' });
    expect(d.events).toHaveLength(2);
    expect(d.events[1]).toMatchObject({ stage: 'plan', detail: 'Authored plan', kind: 'done', durationMs: 5000, at: '2026-07-04T00:10:00.000Z' });
  });

  it('resolves only the matching stage — a running line for another stage is left alone', () => {
    const d = buildInitialDetails();
    d.events = [running('plan', 'Authoring plan from spec')];
    resolveRunningEventInPlace(d, { stage: 'review', phase: 'review', detail: 'Reviewed code', kind: 'done', durationMs: 3000, at: '2026-07-04T00:20:00.000Z' });
    expect(d.events).toHaveLength(2);
    expect(d.events[0]).toMatchObject({ kind: 'action', detail: 'Authoring plan from spec' }); // untouched
    expect(d.events[1]).toMatchObject({ stage: 'review', detail: 'Reviewed code', kind: 'done' });
  });

  it('resolves to error on a failed terminal', () => {
    const d = buildInitialDetails();
    d.events = [running('plan', 'Running plan audit pass 1')];
    resolveRunningEventInPlace(d, { stage: 'plan', phase: 'validate', detail: 'Audited plan — failed', kind: 'error', durationMs: 1000, at: AT });
    expect(d.events[0]).toMatchObject({ kind: 'error', detail: 'Audited plan — failed (pass 1)' });
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
