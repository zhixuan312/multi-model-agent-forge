import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordActivity, resolveRunningActivity } = vi.hoisted(() => ({
  recordActivity: vi.fn(async () => {}),
  resolveRunningActivity: vi.fn(async () => 0),
}));
vi.mock('@/activity/project-activity', () => ({ recordActivity, resolveRunningActivity }));

import { executeDetailsAction } from '@/automation/details-actions';
import type { AutoAction } from '@/automation/details-resolver';
import { createMockDb } from '../test-utils/mock-db';
import { buildInitialDetails, type Details } from '@/details/schema';

/**
 * Behavioral coverage of the executeDetailsAction switch (beyond the static
 * one-case-per-kind ratchet): a pure-details effect must run its mutation through
 * updateDetails and return 'ok'. approve_learning is the monotonic learning
 * approval — it only ever sets a learning to 'kept', matching the resolver, which
 * never un-approves.
 */
function journalWithLearning(status: 'proposed' | 'kept'): Details {
  const d = buildInitialDetails();
  d.stages.spec.status = 'done';
  d.stages.plan.status = 'done';
  d.stages.execute.status = 'done';
  d.stages.review.status = 'done';
  d.stages.journal.status = 'active';
  d.stages.journal.phases.journal.status = 'active';
  d.stages.journal.phases.journal.learnings = [{ heading: 'Prefer X over Y', type: 'decision', status }];
  return d;
}

function writtenDetails(db: ReturnType<typeof createMockDb>): Details {
  const setCall = db._callsFor('project').find((c) => c.method === 'set');
  return (setCall!.args[0] as { details: Details }).details;
}

describe('executeDetailsAction — approve_learning (monotonic, behavioral)', () => {
  const action = {
    kind: 'approve_learning', note: '', stage: 'journal', phase: 'journal', data: { learningIndex: 0 },
  } as unknown as AutoAction;

  beforeEach(() => recordActivity.mockClear());

  it('sets the learning status to kept and returns ok', async () => {
    const db = createMockDb({
      'select:project': [{ details: journalWithLearning('proposed'), detailsVersion: 1 }],
      'update:project': [{ id: 'p' }],
    });
    const result = await executeDetailsAction('p', action, db);
    expect(result).toBe('ok');
    expect(writtenDetails(db).stages.journal.phases.journal.learnings[0].status).toBe('kept');
  });

  it('is idempotent — re-approving an already-kept learning leaves it kept (one-way)', async () => {
    const db = createMockDb({
      'select:project': [{ details: journalWithLearning('kept'), detailsVersion: 1 }],
      'update:project': [{ id: 'p' }],
    });
    await executeDetailsAction('p', action, db);
    expect(writtenDetails(db).stages.journal.phases.journal.learnings[0].status).toBe('kept');
  });
});

describe('executeDetailsAction activity attribution', () => {
  beforeEach(() => recordActivity.mockClear());

  it('attributes advance_phase to the manual actor as source=user', async () => {
    const d = buildInitialDetails();
    d.stages.spec.status = 'active';
    d.stages.spec.phases.outline.status = 'active';
    const db = createMockDb({
      'select:project': [{ details: d, detailsVersion: 1 }],
      'select:team_member': [{ id: 'member-1', displayName: 'Avery', avatarTint: '#09f' }],
      'update:project': [{ id: 'proj-1' }],
    });
    await executeDetailsAction('proj-1', {
      kind: 'advance_phase',
      note: 'Continue to Craft',
      stage: 'spec',
      phase: 'craft',
      data: { actorId: 'member-1' },
    } as never, db);
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      source: 'user',
      eventKey: 'phase_advance:proj-1:spec:craft',
      actor: expect.objectContaining({ id: 'member-1', name: 'Avery' }),
    }));
    // Single-owner proof (FR-18): the transition writes EXACTLY one activity row. Combined with
    // I-6's assertion that the driver's emit is publish-only, no logical action double-writes.
    expect(recordActivity).toHaveBeenCalledTimes(1);
  });

  it('attributes advance_stage to Forge when actorId is omitted', async () => {
    const d = buildInitialDetails();
    d.stages.execute.status = 'active';
    d.stages.execute.phases.implement.status = 'active';
    const db = createMockDb({
      'select:project': [{ details: d, detailsVersion: 1 }],
      'select:team_member': [{ id: '00000000-0000-0000-0000-000000000000', displayName: 'Forge', avatarTint: '#9a6b4f' }],
      'update:project': [{ id: 'proj-1' }],
    });
    await executeDetailsAction('proj-1', {
      kind: 'advance_stage',
      note: 'Continue to Review',
      stage: 'review',
      phase: 'review',
    } as never, db);
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      source: 'mma',
      eventKey: 'stage_advance:proj-1:review',
      actor: expect.objectContaining({ id: '00000000-0000-0000-0000-000000000000' }),
    }));
    expect(recordActivity).toHaveBeenCalledTimes(1);
  });

  it('attributes approve_task to the manual actor', async () => {
    const d = buildInitialDetails();
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'active';
    d.stages.plan.phases.refine.tasks = [{ id: 'task-1', title: 'Task 1', status: 'pending', approvals: [], attempts: [], reviewPolicy: 'reviewed' }];
    const db = createMockDb({
      'select:project': [{ details: d, detailsVersion: 1 }],
      'select:team_member': [{ id: 'member-1', displayName: 'Avery', avatarTint: '#09f' }],
      'update:project': [{ id: 'proj-1' }],
    });
    await executeDetailsAction('proj-1', {
      kind: 'approve_task',
      note: 'Approve task',
      stage: 'plan',
      phase: 'refine',
      data: { actorId: 'member-1', taskId: 'task-1' },
    } as never, db);
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'approve_task:proj-1:task-1',
      source: 'user',
    }));
    expect(recordActivity).toHaveBeenCalledTimes(1);
  });
});
