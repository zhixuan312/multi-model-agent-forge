import { describe, it, expect } from 'vitest';

function mockDb(counts: { draftedComponents: number; planTasks: number; executingTasks: number; totalTasks: number }) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([counts]),
      }),
    }),
  } as any;
}

describe('getStagePermissions', () => {
  it('all stages mutable when project is fresh', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const db = mockDb({ draftedComponents: 0, planTasks: 0, executingTasks: 0, totalTasks: 0 });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.explore.canMutate).toBe(true);
    expect(perms.spec.canMutate).toBe(true);
    expect(perms.plan.canMutate).toBe(true);
  });

  it('explore locks when spec has drafted components', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const db = mockDb({ draftedComponents: 3, planTasks: 0, executingTasks: 0, totalTasks: 0 });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.explore.canMutate).toBe(false);
    expect(perms.explore.reason).toContain('spec');
    expect(perms.spec.canMutate).toBe(true);
  });

  it('spec locks when plan tasks exist', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const db = mockDb({ draftedComponents: 8, planTasks: 14, executingTasks: 0, totalTasks: 14 });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.spec.canMutate).toBe(false);
    expect(perms.spec.reason).toContain('plan');
    expect(perms.explore.canMutate).toBe(false);
  });

  it('plan locks when any task has started executing', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const db = mockDb({ draftedComponents: 8, planTasks: 14, executingTasks: 2, totalTasks: 14 });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.plan.canMutate).toBe(false);
    expect(perms.plan.reason).toContain('execution');
  });

  it('canAdvance stays true even when canMutate is false', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const db = mockDb({ draftedComponents: 8, planTasks: 14, executingTasks: 0, totalTasks: 14 });
    const perms = await getStagePermissions(db, 'p1');
    expect(perms.spec.canMutate).toBe(false);
    expect(perms.spec.canAdvance).toBe(true);
    expect(perms.explore.canAdvance).toBe(true);
    expect(perms.plan.canAdvance).toBe(true);
  });

  it('throws on missing project', async () => {
    const { getStagePermissions } = await import('@/projects/stage-gate');
    const db = { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) } as any;
    await expect(getStagePermissions(db, 'nonexistent')).rejects.toThrow();
  });
});
