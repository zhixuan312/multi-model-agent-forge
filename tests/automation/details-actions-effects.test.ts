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
