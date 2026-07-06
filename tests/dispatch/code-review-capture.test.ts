import { handleCodeReview } from '@/dispatch/handlers/code-review';
import type { MmaBatchCtx } from '@/dispatch/handler-registry';
import { buildInitialDetails, validateDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

const ctx = (): MmaBatchCtx => ({
  batchRowId: 'batch-9', projectId: 'p', handler: 'code-review', request: { repoId: 'r1' }, actorId: null,
});
const envelope = (blockId: string | null) => ({
  task: { status: 'completed' },
  output: { findings: [], ...(blockId ? { contextBlockId: blockId } : {}) },
});
function writtenRepoAttempt(db: ReturnType<typeof createMockDb>) {
  const setCall = db._callsFor('project').find((c) => c.method === 'set');
  const d = validateDetails((setCall!.args[0] as { details: unknown }).details);
  const entry = d.stages.review.phases.review.repos.find((x) => x.repoId === 'r1')!;
  return entry.reviewPasses[0].review!.attempts[0];
}

describe('handleCodeReview — persisted contextBlockId', () => {
  it("stores output.contextBlockId='RB1' on the per-repo review attempt", async () => {
    const db = createMockDb({
      'select:project': [{ details: buildInitialDetails(), detailsVersion: 1 }],
      'update:project': [{ id: 'p' }],
    });
    await handleCodeReview(db, ctx(), envelope('RB1'));
    expect(writtenRepoAttempt(db).contextBlockId).toBe('RB1');
  });
  it('stores null when the envelope carries no block id', async () => {
    const db = createMockDb({
      'select:project': [{ details: buildInitialDetails(), detailsVersion: 1 }],
      'update:project': [{ id: 'p' }],
    });
    await handleCodeReview(db, ctx(), envelope(null));
    expect(writtenRepoAttempt(db).contextBlockId).toBeNull();
  });
});
