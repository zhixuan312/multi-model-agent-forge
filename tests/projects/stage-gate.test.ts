import { describe, it, expect } from 'vitest';

function mockDb(stageStatuses: Record<string, string>) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(
          Object.entries(stageStatuses).map(([kind, status]) => ({ kind, status })),
        ),
      }),
    }),
  } as any;
}

describe('getStagePermissions', () => {
  it('all stages mutable when project is fresh', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const db = mockDb({
      exploration: 'pending', spec: 'pending', plan: 'pending',
      execute: 'pending', review: 'pending', journal: 'pending',
    });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.explore.canMutate).toBe(true);
    expect(perms.spec.canMutate).toBe(true);
    expect(perms.plan.canMutate).toBe(true);
  });

  it('design stages stay editable during design phase', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const db = mockDb({
      exploration: 'active', spec: 'active', plan: 'pending',
      execute: 'pending', review: 'pending', journal: 'pending',
    });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.explore.canMutate).toBe(true);
    expect(perms.spec.canMutate).toBe(true);
    expect(perms.plan.canMutate).toBe(true);
  });

  it('design stages lock when execute is done', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const db = mockDb({
      exploration: 'done', spec: 'done', plan: 'done',
      execute: 'done', review: 'active', journal: 'pending',
    });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.explore.canMutate).toBe(false);
    expect(perms.spec.canMutate).toBe(false);
    expect(perms.plan.canMutate).toBe(false);
    expect(perms.execute.canMutate).toBe(false);
    expect(perms.review.canMutate).toBe(true);
  });

  it('canAdvance stays true regardless of locking', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const db = mockDb({
      exploration: 'done', spec: 'done', plan: 'done',
      execute: 'done', review: 'active', journal: 'pending',
    });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.explore.canAdvance).toBe(true);
    expect(perms.spec.canAdvance).toBe(true);
    expect(perms.plan.canAdvance).toBe(true);
  });

  it('review locks when done', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const db = mockDb({
      exploration: 'done', spec: 'done', plan: 'done',
      execute: 'done', review: 'done', journal: 'active',
    });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.review.canMutate).toBe(false);
    expect(perms.journal.canMutate).toBe(true);
  });
});
