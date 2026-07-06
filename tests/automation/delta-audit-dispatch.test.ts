import { vi } from 'vitest';

const dispatchCalls: any[] = [];
vi.mock('@/dispatch/dispatch-helpers', () => ({
  dispatchMma: async (opts: any) => { dispatchCalls.push(opts); return { batchRowId: 'b', batchId: 'e' }; },
  findInflight: async () => null,
}));
vi.mock('@/mma/server-client', () => ({ buildMmaClient: async () => ({}) }));

import { executeDetailsAction } from '@/automation/details-actions';
import type { AutoAction } from '@/automation/details-resolver';
import { buildInitialDetails, type Details } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

function specWithPriorAudit(blockId: string | null): Details {
  const d = buildInitialDetails();
  d.stages.spec.status = 'active';
  d.stages.spec.phases.finalize.status = 'active';
  d.stages.spec.phases.finalize.auditPasses.push({
    passNo: 1, status: 'revised',
    audit: { attempts: [{ batchId: 'prev', status: 'done', at: '2026-07-06T00:00:00Z', contextBlockId: blockId }] },
  });
  return d;
}
const dispatchAudit = { kind: 'dispatch_audit', note: '', stage: 'spec', phase: 'finalize' } as unknown as AutoAction;

describe('dispatch_audit — delta context block', () => {
  beforeEach(() => { dispatchCalls.length = 0; });

  it('adds contextBlockIds:[prev] when the last pass carries a block id', async () => {
    const db = createMockDb({ 'select:project': [{ details: specWithPriorAudit('B1'), detailsVersion: 1 }], 'update:project': [{ id: 'p' }] });
    await executeDetailsAction('p', dispatchAudit, db);
    expect(dispatchCalls[0].body.contextBlockIds).toEqual(['B1']);
    expect(dispatchCalls[0].body.subtype).toBe('spec');
  });

  it('omits contextBlockIds when the last pass block id is null', async () => {
    const db = createMockDb({ 'select:project': [{ details: specWithPriorAudit(null), detailsVersion: 1 }], 'update:project': [{ id: 'p' }] });
    await executeDetailsAction('p', dispatchAudit, db);
    expect(dispatchCalls[0].body.contextBlockIds).toBeUndefined();
  });

  it('omits contextBlockIds on the first round (no prior pass)', async () => {
    const first = buildInitialDetails(); first.stages.spec.status = 'active'; first.stages.spec.phases.finalize.status = 'active';
    const db = createMockDb({ 'select:project': [{ details: first, detailsVersion: 1 }], 'update:project': [{ id: 'p' }] });
    await executeDetailsAction('p', dispatchAudit, db);
    expect(dispatchCalls[0].body.contextBlockIds).toBeUndefined();
  });
});

function reviewWithRepos(): Details {
  const d = buildInitialDetails();
  d.stages.review.status = 'active';
  d.stages.review.phases.review.status = 'active';
  d.repos = [
    { id: 'r1', name: 'a', pathOnDisk: '/tmp/a', defaultBranch: 'main' },
    { id: 'r2', name: 'b', pathOnDisk: '/tmp/b', defaultBranch: 'main' },
  ];
  d.stages.review.phases.review.repos = [
    { repoId: 'r1', reviewPasses: [{ passNo: 1, status: 'revised', review: { attempts: [{ batchId: 'pr1', status: 'done', at: 't', contextBlockId: 'RB1' }] } }] },
    // r2 has no prior pass → no delta
  ];
  return d;
}
const dispatchReview = { kind: 'dispatch_review', note: '', stage: 'review', phase: 'review' } as unknown as AutoAction;

describe('dispatch_review — per-repo delta context block', () => {
  beforeEach(() => { dispatchCalls.length = 0; });

  it('threads each repo its OWN prior review block id, independently', async () => {
    const db = createMockDb({ 'select:project': [{ details: reviewWithRepos(), detailsVersion: 1 }], 'update:project': [{ id: 'p' }] });
    await executeDetailsAction('p', dispatchReview, db);
    const byRepo = Object.fromEntries(dispatchCalls.map((c) => [c.meta.repoId, c.body.contextBlockIds]));
    expect(byRepo['r1']).toEqual(['RB1']);
    expect(byRepo['r2']).toBeUndefined(); // no prior pass → no delta, no cross-repo bleed
  });
});
