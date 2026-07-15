import { performTransition, TransitionRejected, isForeignLeaseFresh } from '@/automation/perform-transition';
import { createMockDb } from '../test-utils/mock-db';
import { buildInitialDetails, buildSubsetDetails, validateDetails, type Details } from '@/details/schema';
import { executeDetailsAction } from '@/automation/details-actions';
import { repairActiveStage } from '@/automation/stage-repair';

function finalizeActive(): Details {
  const d = buildInitialDetails();
  d.stages.exploration.status = 'done';
  d.stages.spec.status = 'active';
  d.stages.spec.phases.finalize.status = 'active';
  return d;
}

function projRow(details: Details, version = 1, autoStatus: 'off' | 'running' = 'off') {
  details.automation.status = autoStatus;
  return { details, detailsVersion: version, autoMode: autoStatus === 'running' };
}

describe('performTransition — gate (spec §2.4, AC4/AC17)', () => {
  it('rejects an action not in allowedActions', async () => {
    const db = createMockDb({ 'select:project': [projRow(finalizeActive(), 1, 'running')] });
    await expect(
      performTransition(db, 'p', { kind: 'mark_complete' }, { mode: 'auto' }),
    ).rejects.toBeInstanceOf(TransitionRejected);
  });

  it('rejects a manual action while auto is running (except take_over) [AC17]', async () => {
    const db = createMockDb({ 'select:project': [projRow(finalizeActive(), 1, 'running')] });
    await expect(
      performTransition(db, 'p', { kind: 'dispatch_audit' }, { mode: 'manual', actorId: 'u1' }),
    ).rejects.toBeInstanceOf(TransitionRejected);
  });

  it('rejects a driver action while auto is off [AC17]', async () => {
    const db = createMockDb({ 'select:project': [projRow(finalizeActive(), 1, 'off')] });
    await expect(
      performTransition(db, 'p', { kind: 'dispatch_audit' }, { mode: 'auto' }),
    ).rejects.toBeInstanceOf(TransitionRejected);
  });

  it('rejects an advancing action while a FRESH FOREIGN lease is held (single-flight)', async () => {
    const d = finalizeActive();
    d.automation.status = 'off'; // manual mode allowed
    d.automation.driverId = 'other-holder';
    d.automation.driverHeartbeatAt = new Date().toISOString(); // fresh
    const db = createMockDb({ 'select:project': [{ details: d, detailsVersion: 1, autoMode: false }] });
    await expect(
      performTransition(db, 'p', { kind: 'dispatch_audit' }, { mode: 'manual', actorId: 'me' }),
    ).rejects.toThrow(/busy/);
  });

  it('does NOT reject as busy when the fresh lease is held by the SAME actor', async () => {
    // A stale/own lease must not trigger the foreign-fresh guard. We assert the guard
    // itself via a direct helper so the test never reaches the real MMA effect.
    const d = finalizeActive();
    d.automation.driverId = 'me';
    d.automation.driverHeartbeatAt = new Date().toISOString();
    expect(isForeignLeaseFresh(d.automation, 'me')).toBe(false);
    expect(isForeignLeaseFresh(d.automation, 'other')).toBe(true);
  });

  it('treats an advance of an already-done from-stage as an idempotent no-op (client navigates, no error)', async () => {
    // Subset run: exploration done (satisfied at creation), spec active. The "Continue to
    // Spec" button posts advance_stage from exploration — not in the allowed set — but the
    // stage is already past, so it must resolve (no throw) instead of "not allowed now".
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'active';
    d.stages.spec.phases.outline.status = 'active';
    const db = createMockDb({ 'select:project': [projRow(d, 1, 'off')] });
    await expect(
      performTransition(db, 'p', { kind: 'advance_stage', from: 'exploration' }, { mode: 'manual', actorId: 'u1' }),
    ).resolves.toBeUndefined();
  });

  it('still rejects an advance when the from-stage is NOT done (genuinely cannot advance yet)', async () => {
    // Fresh project: exploration active, brief active — advance_stage is not allowed AND the
    // stage is not done, so it must still reject (never route into a half-advanced project).
    const db = createMockDb({ 'select:project': [projRow(buildInitialDetails(), 1, 'off')] });
    await expect(
      performTransition(db, 'p', { kind: 'advance_stage', from: 'exploration' }, { mode: 'manual', actorId: 'u1' }),
    ).rejects.toBeInstanceOf(TransitionRejected);
  });

  it('translates an effect "inflight" result into a TransitionRejected (never a silent no-op)', async () => {
    // executeDetailsAction returns 'inflight' when its per-target guard finds a batch
    // already dispatched/running for the handler. performTransition must surface that
    // as a rejection so the manual route returns 409 (not a success-reported no-op).
    const db = createMockDb({
      'select:project': [projRow(finalizeActive(), 1, 'running')],
      'select:ops_mma_batch': [{ id: 'inflight-1', handler: 'spec-audit', status: 'running' }],
    });
    await expect(
      performTransition(db, 'p', { kind: 'dispatch_audit' }, { mode: 'auto' }),
    ).rejects.toThrow(/in flight/);
  });
});

describe('performTransition — persists the exactly-one-active repair (AC16)', () => {
  it('writes the repaired details when it demotes a stray second active stage', async () => {
    const d = finalizeActive();
    d.stages.plan.status = 'active'; // illegal second active stage
    // A later mark_complete is rejected at the gate, but the repair must have PERSISTED
    // before that — otherwise the corruption survives on disk.
    const db = createMockDb({
      'select:project': [{ details: d, detailsVersion: 1, autoMode: true }],
      'update:project': [{ id: 'p' }], // the repair's optimistic update succeeds
    });
    await expect(
      performTransition(db, 'p', { kind: 'mark_complete' }, { mode: 'auto' }),
    ).rejects.toBeInstanceOf(TransitionRejected);
    const projectSets = db._callsFor('project').filter((c) => c.method === 'set');
    expect(projectSets.length).toBeGreaterThan(0); // the repair write happened
  });
});

describe('mark_complete', () => {
  it('preserves skipped execute/review statuses on subset completion', async () => {
    const d = buildSubsetDetails({
      selectedDesignStages: ['spec', 'plan'],
      uploadedExplorationFile: '/tmp/exploration.md',
    });
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'done';
    d.stages.journal.status = 'active';
    const db = createMockDb({
      'select:project': [{ details: d, detailsVersion: 0 }],
      'update:project': [{ id: 'p1' }],
    });
    await executeDetailsAction('p1', { kind: 'mark_complete', note: '', stage: 'journal', phase: 'summary' }, db);
    const setCalls = db._callsFor('project').filter((c) => c.method === 'set');
    const updated = validateDetails((setCalls[0].args[0] as { details: unknown }).details);
    expect(updated.stages.execute.status).toBe('skipped');
    expect(updated.stages.review.status).toBe('skipped');
  });
});

describe('repairActiveStage', () => {
  it('activates the first non-skipped, non-done stage when no stage is active', () => {
    const d = buildSubsetDetails({
      selectedDesignStages: ['plan'],
      uploadedSpec: {
        filePath: '/tmp/spec.md',
        selectedTemplateIds: ['tpl-context'],
        components: [{ id: 'comp-1', templateId: 'tpl-context', approvals: [] }],
      },
      forgeApprovalMemberId: '00000000-0000-0000-0000-000000000000',
    });
    d.stages.plan.status = 'pending';
    const result = repairActiveStage(d);
    expect(result.changed).toBe(true);
    expect(d.stages.plan.status).toBe('active');
    expect(d.stages.execute.status).toBe('skipped');
  });
});

describe('approve_stage hop-over (advanceStage skips skipped stages)', () => {
  it('advances a spec+plan subset from Plan straight to Journal, never re-activating skipped execute/review', async () => {
    const d = buildSubsetDetails({
      selectedDesignStages: ['spec', 'plan'],
      uploadedExplorationFile: '/tmp/exploration.md',
    });
    // Spec already done (uploaded exploration seeds spec active → drive it done), Plan active+validated.
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'done';
    d.stages.plan.phases.validate.status = 'active';
    const db = createMockDb({
      'select:project': [{ details: d, detailsVersion: 0 }],
      'update:project': [{ id: 'p1' }],
    });
    // approve_stage on plan calls advanceStage(db, id, 'execute'); execute+review are
    // skipped, so the hop-over must land on journal (active), not execute.
    await executeDetailsAction('p1', { kind: 'approve_stage', note: '', stage: 'plan', phase: 'validate' }, db);
    const setCalls = db._callsFor('project').filter((c) => c.method === 'set');
    const updated = validateDetails((setCalls[setCalls.length - 1].args[0] as { details: unknown }).details);
    expect(updated.stages.execute.status).toBe('skipped');
    expect(updated.stages.review.status).toBe('skipped');
    expect(updated.stages.journal.status).toBe('active');
    expect(updated.stages.plan.status).toBe('done');
  });
});
