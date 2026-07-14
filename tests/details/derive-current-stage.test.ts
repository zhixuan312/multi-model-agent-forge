import { deriveCurrentStage, deriveStageAndPhase } from '@/details/write';
import { getCurrentPhase } from '@/details/read';
import { createMockDb } from '../test-utils/mock-db';
import { buildInitialDetails, buildSubsetDetails } from '@/details/schema';

const STAGES = ['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const;

describe('deriveStageAndPhase (pure projection of details → columns)', () => {
  it('returns the active stage + its phase', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.execute.status = 'active';
    expect(deriveStageAndPhase(d)).toEqual({ currentStage: 'execute', phase: 'build' });
  });

  it('returns journal / completed when every stage is done or skipped', () => {
    const d = buildSubsetDetails({
      selectedDesignStages: ['spec', 'plan'],
      uploadedExplorationFile: '/tmp/exploration.md',
    });
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'done';
    d.stages.journal.status = 'done';
    for (const phase of Object.values(d.stages.journal.phases as Record<string, { status: string }>)) phase.status = 'done';
    expect(deriveStageAndPhase(d)).toEqual({ currentStage: 'journal', phase: 'completed' });
  });

  it('falls back to the furthest passed stage when none is active', () => {
    const d = buildSubsetDetails({
      selectedDesignStages: ['spec', 'plan'],
      uploadedExplorationFile: '/tmp/exploration.md',
    });
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'pending';
    // The furthest passed stage: review (skipped) is after plan, so it's the furthest passed
    expect(deriveStageAndPhase(d)).toEqual({ currentStage: 'review', phase: 'build' });
  });

  it('returns exploration / design for a fresh project (nothing started)', () => {
    const d = buildInitialDetails();
    for (const s of STAGES) d.stages[s].status = 'pending';
    expect(deriveStageAndPhase(d)).toEqual({ currentStage: 'exploration', phase: 'design' });
  });
});

describe('getCurrentPhase', () => {
  it('returns null for a skipped stage', () => {
    const d = buildSubsetDetails({
      selectedDesignStages: ['exploration'],
    });
    expect(getCurrentPhase(d, 'execute')).toBeNull();
    expect(getCurrentPhase(d, 'review')).toBeNull();
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
});
