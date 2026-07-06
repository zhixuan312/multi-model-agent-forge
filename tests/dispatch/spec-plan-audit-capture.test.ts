import { handleSpecAudit } from '@/dispatch/handlers/spec-audit';
import { handlePlanAudit } from '@/dispatch/handlers/plan-audit';
import type { MmaBatchCtx } from '@/dispatch/handler-registry';
import { buildInitialDetails, validateDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

const ctx = (): MmaBatchCtx => ({
  batchRowId: 'batch-1', projectId: 'p', handler: 'spec-audit', request: null, actorId: null,
});
// clean audit (no findings) carrying an optional top-level block id in output
const envelope = (blockId: string | null) => ({
  task: { status: 'completed' },
  output: { summary: { findings: [] }, ...(blockId ? { contextBlockId: blockId } : {}) },
});
// Pull the details object the handler wrote from the recorded update().set(...) call.
function writtenDetails(db: ReturnType<typeof createMockDb>) {
  const setCall = db._callsFor('project').find((c) => c.method === 'set');
  return validateDetails((setCall!.args[0] as { details: unknown }).details);
}

describe('handleSpecAudit — persisted contextBlockId', () => {
  it("stores output.contextBlockId='B1' on the spec finalize audit attempt", async () => {
    const db = createMockDb({
      'select:project': [{ details: buildInitialDetails(), detailsVersion: 1 }],
      'update:project': [{ id: 'p' }],
    });
    await handleSpecAudit(db, ctx(), envelope('B1'));
    expect(writtenDetails(db).stages.spec.phases.finalize.auditPasses[0].audit!.attempts[0].contextBlockId).toBe('B1');
  });
  it('stores null when the envelope carries no block id', async () => {
    const db = createMockDb({
      'select:project': [{ details: buildInitialDetails(), detailsVersion: 1 }],
      'update:project': [{ id: 'p' }],
    });
    await handleSpecAudit(db, ctx(), envelope(null));
    expect(writtenDetails(db).stages.spec.phases.finalize.auditPasses[0].audit!.attempts[0].contextBlockId).toBeNull();
  });
});

describe('handlePlanAudit — persisted contextBlockId', () => {
  it("stores output.contextBlockId='B1' on the plan validate audit attempt", async () => {
    const db = createMockDb({
      'select:project': [{ details: buildInitialDetails(), detailsVersion: 1 }],
      'update:project': [{ id: 'p' }],
    });
    await handlePlanAudit(db, { ...ctx(), handler: 'plan-audit' }, envelope('B1'));
    expect(writtenDetails(db).stages.plan.phases.validate.auditPasses[0].audit!.attempts[0].contextBlockId).toBe('B1');
  });
  it('stores null when the envelope carries no block id', async () => {
    const db = createMockDb({
      'select:project': [{ details: buildInitialDetails(), detailsVersion: 1 }],
      'update:project': [{ id: 'p' }],
    });
    await handlePlanAudit(db, { ...ctx(), handler: 'plan-audit' }, envelope(null));
    expect(writtenDetails(db).stages.plan.phases.validate.auditPasses[0].audit!.attempts[0].contextBlockId).toBeNull();
  });
});
