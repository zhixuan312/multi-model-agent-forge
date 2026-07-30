// @vitest-environment node
import { vi } from 'vitest';
import { buildInitialDetails, type Details } from '@/details/schema';
import { resolveNextActionFromDetails } from '@/automation/details-resolver';
import { auditLoopStep, auditInFlight, type AuditPassLike } from '@/automation/audit-loop-policy';

/**
 * The engine's `cancelled` terminal is DELIBERATE — someone stopped the work. Automation
 * must treat it as terminal-and-intentional and PARK the stage. A `failed` attempt still
 * re-dispatches (an engine `interrupted` task surfaces as `failed` precisely so it gets
 * resubmitted), so every case below is paired: cancelled parks, failed retries.
 */

const at = '2026-07-30T00:00:00Z';

function planRefineActive(): Details {
  const d = buildInitialDetails();
  d.stages.exploration.status = 'done';
  d.stages.spec.status = 'done';
  d.stages.plan.status = 'active';
  d.stages.plan.phases.refine.status = 'active';
  d.repos = [{ id: 'r1', name: 'repo', pathOnDisk: '/w/repo', defaultBranch: 'main' }];
  return d;
}

function executeActive(): Details {
  const d = buildInitialDetails();
  d.stages.exploration.status = 'done';
  d.stages.spec.status = 'done';
  d.stages.plan.status = 'done';
  d.stages.execute.status = 'active';
  d.stages.execute.phases.implement.status = 'active';
  return d;
}

describe('automation: a cancelled attempt parks; a failed attempt retries', () => {
  it('plan author — failed re-dispatches', () => {
    const d = planRefineActive();
    d.stages.plan.phases.refine.attempts = [{ batchId: 'b1', status: 'failed', at }];
    expect(resolveNextActionFromDetails(d).kind).toBe('dispatch_plan_author');
  });

  it('plan author — cancelled does NOT re-dispatch (parks on wait)', () => {
    const d = planRefineActive();
    d.stages.plan.phases.refine.attempts = [{ batchId: 'b1', status: 'cancelled', at }];
    expect(resolveNextActionFromDetails(d).kind).toBe('wait');
  });

  it('execute — failed re-dispatches (no committed code yet)', () => {
    const d = executeActive();
    d.stages.execute.phases.implement.repos = [{ repoId: 'r1', attempts: [{ batchId: 'e1', status: 'failed', at }] }];
    expect(resolveNextActionFromDetails(d).kind).toBe('dispatch_execute');
  });

  it('execute — cancelled does NOT re-dispatch, and does NOT advance past a stage with no committed code', () => {
    const d = executeActive();
    d.stages.execute.phases.implement.repos = [{ repoId: 'r1', attempts: [{ batchId: 'e1', status: 'cancelled', at }] }];
    const action = resolveNextActionFromDetails(d);
    expect(action.kind).toBe('wait');
    expect(action.kind).not.toBe('advance_stage');
  });

  it('plan task validation — cancelled parks instead of falling through to approve_task', () => {
    // The dangerous fall-through: without the parked check, a cancelled validation attempt
    // is "not running, not failed" → the resolver would APPROVE a task it never validated.
    const d = planRefineActive();
    d.stages.plan.phases.refine.file = 'plan.md';
    d.stages.plan.phases.refine.tasks = [
      { id: 't1', title: 'T1', status: 'pending', approvals: [], attempts: [{ batchId: 'v1', status: 'cancelled', at }], reviewPolicy: 'reviewed' },
    ];
    expect(resolveNextActionFromDetails(d).kind).toBe('wait');

    d.stages.plan.phases.refine.tasks[0].attempts = [{ batchId: 'v1', status: 'done', at }];
    expect(resolveNextActionFromDetails(d).kind).toBe('approve_task');
  });

  it('journal harvest — failed re-dispatches, cancelled parks', () => {
    const base = (): Details => {
      const d = buildInitialDetails();
      for (const s of ['exploration', 'spec', 'plan', 'execute', 'review'] as const) d.stages[s].status = 'done';
      d.stages.journal.status = 'active';
      d.stages.journal.phases.journal.status = 'active';
      return d;
    };
    const failed = base();
    failed.stages.journal.phases.journal.attempts = [{ batchId: 'h1', status: 'failed', at }];
    expect(resolveNextActionFromDetails(failed).kind).toBe('dispatch_harvest');

    const cancelled = base();
    cancelled.stages.journal.phases.journal.attempts = [{ batchId: 'h1', status: 'cancelled', at }];
    expect(resolveNextActionFromDetails(cancelled).kind).toBe('wait');
  });
});

describe('audit-loop policy: a cancelled pass attempt suppresses the loop', () => {
  const passes = (status: string): AuditPassLike[] => [
    { passNo: 1, status: 'revised', audit: { attempts: [{ status }] } },
  ];

  it('cancelled audit attempt → in flight (loop waits), same as running', () => {
    expect(auditInFlight(passes('cancelled'))).toBe(true);
    expect(auditLoopStep(passes('cancelled'))).toEqual({ kind: 'wait' });
  });

  it('a failed audit attempt is NOT parked — the loop still applies findings', () => {
    expect(auditInFlight(passes('failed'))).toBe(false);
    expect(auditLoopStep(passes('failed'))).toMatchObject({ kind: 'apply_findings' });
  });

  it('a cancelled FIX attempt also parks the loop (no second audit pass fired)', () => {
    const p: AuditPassLike[] = [{
      passNo: 1, status: 'revised',
      audit: { attempts: [{ status: 'done' }] },
      fix: { attempts: [{ status: 'cancelled' }] },
    }];
    expect(auditLoopStep(p)).toEqual({ kind: 'wait' });
  });
});

describe('reconcileStuckAttempts: flips a stuck attempt to its batch terminal status', () => {
  /**
   * The reconcile is what turns a stranded `running` attempt into an actionable status,
   * so it is the exact place a cancellation could be mistaken for a failure and retried.
   * It must write `cancelled` for a cancelled batch and `failed` for a failed one.
   */
  async function runReconcile(batchStatus: 'failed' | 'cancelled') {
    vi.resetModules();
    const activity: Array<Record<string, unknown>> = [];
    const events: Array<Record<string, unknown>> = [];
    vi.doMock('@/activity/project-activity', () => ({
      recordActivity: async (a: Record<string, unknown>) => { activity.push(a); },
      resolveRunningActivity: async () => 1,
    }));
    vi.doMock('@/sse/event-bus', () => ({
      projectEventBus: { publish: (_p: string, e: Record<string, unknown>) => { events.push(e); } },
    }));

    const d = planRefineActive();
    d.stages.plan.phases.refine.attempts = [{ batchId: 'b1', status: 'running', at }];

    let written: Details | null = null;
    vi.doMock('@/details/write', () => ({
      updateDetails: async (_db: unknown, _pid: string, fn: (x: Details) => Details) => { written = fn(d); },
      advanceStage: async () => {}, advancePhase: async () => {}, reopenStage: async () => {},
      setAutomationStatus: async () => {},
    }));

    const { createMockDb } = await import('../test-utils/mock-db');
    const db = createMockDb({
      'select:project': [{ details: d }],
      'select:ops_mma_batch': [{ id: 'b1', status: batchStatus }],
    });

    const { reconcileStuckAttempts } = await import('@/automation/details-actions');
    await reconcileStuckAttempts(db, 'proj-1');
    return { written: written as Details | null, activity, events };
  }

  afterEach(() => { vi.resetModules(); vi.doUnmock('@/activity/project-activity'); });

  it('a cancelled batch flips the attempt to `cancelled` (so the resolver parks, not retries)', async () => {
    const { written, activity } = await runReconcile('cancelled');
    expect(written?.stages.plan.phases.refine.attempts[0].status).toBe('cancelled');
    // And the timeline says cancelled — NOT "failed — retrying", which would be a lie.
    expect(activity[0]?.label).toBe('Plan author cancelled');
    // Proof the parked attempt does not re-dispatch.
    expect(resolveNextActionFromDetails(written!).kind).toBe('wait');
  });

  it('a failed batch still flips to `failed` and announces the retry', async () => {
    const { written, activity } = await runReconcile('failed');
    expect(written?.stages.plan.phases.refine.attempts[0].status).toBe('failed');
    expect(activity[0]?.label).toBe('Plan author failed — retrying');
    expect(resolveNextActionFromDetails(written!).kind).toBe('dispatch_plan_author');
  });
});
