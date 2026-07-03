import { describe, it, expect } from 'vitest';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

function makeDetails(stageStatuses: Record<string, string>) {
  const d = buildInitialDetails();
  for (const [kind, status] of Object.entries(stageStatuses)) {
    if (d.stages[kind as keyof typeof d.stages]) {
      d.stages[kind as keyof typeof d.stages].status = status as 'pending' | 'active' | 'done';
    }
  }
  return d;
}

describe('getStagePermissions', () => {
  it('all stages mutable when project is fresh', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const d = makeDetails({ exploration: 'pending', spec: 'pending', plan: 'pending', execute: 'pending', review: 'pending', journal: 'pending' });
    const db = createMockDb({ 'select:project': [{ completedAt: null, details: d }] });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.explore.canMutate).toBe(true);
    expect(perms.spec.canMutate).toBe(true);
  });

  it('design stages stay editable during design phase', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const d = makeDetails({ exploration: 'active', spec: 'active', plan: 'pending', execute: 'pending', review: 'pending', journal: 'pending' });
    const db = createMockDb({ 'select:project': [{ completedAt: null, details: d }] });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.explore.canMutate).toBe(true);
    expect(perms.plan.canMutate).toBe(true);
  });

  it('design stages lock when execute is done', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const d = makeDetails({ exploration: 'done', spec: 'done', plan: 'done', execute: 'done', review: 'active', journal: 'pending' });
    const db = createMockDb({ 'select:project': [{ completedAt: null, details: d }] });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.explore.canMutate).toBe(false);
    expect(perms.spec.canMutate).toBe(false);
    expect(perms.plan.canMutate).toBe(false);
    expect(perms.execute.canMutate).toBe(false);
    expect(perms.review.canMutate).toBe(true);
  });

  it('review locks when done', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const d = makeDetails({ exploration: 'done', spec: 'done', plan: 'done', execute: 'done', review: 'done', journal: 'active' });
    const db = createMockDb({ 'select:project': [{ completedAt: null, details: d }] });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.review.canMutate).toBe(false);
    expect(perms.journal.canMutate).toBe(true);
  });
});
