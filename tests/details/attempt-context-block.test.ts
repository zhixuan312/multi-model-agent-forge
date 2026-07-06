import { validateDetails, buildInitialDetails } from '@/details/schema';

describe('attemptSchema.contextBlockId', () => {
  it('accepts an attempt carrying a contextBlockId (string), null, and absent', () => {
    const d = buildInitialDetails();
    d.stages.spec.phases.finalize.auditPasses.push({
      passNo: 1, status: 'clean',
      audit: { attempts: [{ batchId: 'b1', status: 'done', at: '2026-07-06T00:00:00Z', contextBlockId: 'B1' }] },
    });
    d.stages.plan.phases.validate.auditPasses.push({
      passNo: 1, status: 'revised',
      audit: { attempts: [{ batchId: 'b2', status: 'done', at: '2026-07-06T00:00:00Z', contextBlockId: null }] },
    });
    // absent contextBlockId still valid (legacy rows)
    d.stages.review.phases.review.repos.push({
      repoId: 'r1', reviewPasses: [{ passNo: 1, status: 'clean', review: { attempts: [{ batchId: 'b3', status: 'done', at: '2026-07-06T00:00:00Z' }] } }],
    });
    const round = validateDetails(d);
    expect(round.stages.spec.phases.finalize.auditPasses[0].audit!.attempts[0].contextBlockId).toBe('B1');
    expect(round.stages.plan.phases.validate.auditPasses[0].audit!.attempts[0].contextBlockId).toBeNull();
    expect(round.stages.review.phases.review.repos[0].reviewPasses[0].review!.attempts[0].contextBlockId).toBeUndefined();
  });
});
