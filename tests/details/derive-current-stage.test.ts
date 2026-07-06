import { deriveCurrentStage, deriveStageAndPhase } from '@/details/write';
import { createMockDb } from '../test-utils/mock-db';
import { buildInitialDetails } from '@/details/schema';

const STAGES = ['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const;

describe('deriveStageAndPhase (pure projection of details → columns)', () => {
  it('returns the active stage + its phase', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.execute.status = 'active';
    expect(deriveStageAndPhase(d)).toEqual({ currentStage: 'execute', phase: 'build' });
  });

  it('returns journal / completed when EVERY stage is done (activates the completed phase)', () => {
    const d = buildInitialDetails();
    for (const s of STAGES) d.stages[s].status = 'done';
    expect(deriveStageAndPhase(d)).toEqual({ currentStage: 'journal', phase: 'completed' });
  });

  it('falls back to the furthest done stage when none is active (transient between-stages)', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    // nothing active, not all done → furthest done = spec (design)
    expect(deriveStageAndPhase(d)).toEqual({ currentStage: 'spec', phase: 'design' });
  });

  it('returns exploration / design for a fresh project (nothing started)', () => {
    const d = buildInitialDetails();
    for (const s of STAGES) d.stages[s].status = 'pending';
    expect(deriveStageAndPhase(d)).toEqual({ currentStage: 'exploration', phase: 'design' });
  });
});

describe('deriveCurrentStage (single mirror of currentStage/phase, AC8)', () => {
  it('writes project.currentStage = the active stage in details', async () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    const db = createMockDb({ 'select:project': [{ details: d }] });
    await deriveCurrentStage(db, 'p');
    const setCalls = db._callsFor('project').filter((c) => c.method === 'set');
    expect(setCalls.some((c) => (c.args[0] as Record<string, unknown>)?.currentStage === 'plan')).toBe(true);
  });

  it('mirrors the phase group from the active stage (plan → design)', async () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    const db = createMockDb({ 'select:project': [{ details: d }] });
    await deriveCurrentStage(db, 'p');
    const setCalls = db._callsFor('project').filter((c) => c.method === 'set');
    expect(setCalls.some((c) => (c.args[0] as Record<string, unknown>)?.phase === 'design')).toBe(true);
  });

  it('writes phase=completed on a finished project (no active stage) — the mark_complete heal', async () => {
    const d = buildInitialDetails();
    for (const s of STAGES) d.stages[s].status = 'done';
    const db = createMockDb({ 'select:project': [{ details: d }] });
    await deriveCurrentStage(db, 'p');
    const set = db._callsFor('project').filter((c) => c.method === 'set').map((c) => c.args[0] as Record<string, unknown>);
    // Before the fix this bailed (no active stage) and left the stale phase on disk.
    expect(set.some((a) => a.phase === 'completed' && a.currentStage === 'journal')).toBe(true);
  });
});
