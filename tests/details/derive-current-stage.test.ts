import { deriveCurrentStage } from '@/details/write';
import { createMockDb } from '../test-utils/mock-db';
import { buildInitialDetails } from '@/details/schema';

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
});
