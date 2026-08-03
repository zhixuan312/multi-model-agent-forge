import { deriveNextAction } from '@/dashboard/next-action';

describe('deriveNextAction', () => {
  const base = { phase: 'design' as const, currentStage: 'spec' as const, awaitingHuman: 0, auditsNeedingFix: 0 };

  it('human gate wins over everything', () => {
    expect(deriveNextAction({ ...base, phase: 'build', awaitingHuman: 2 })).toEqual({
      label: 'Review — 2 sections need you',
      tone: 'attention',
    });
  });

  it('singular section copy agrees with its verb', () => {
    // This asserted 'Review — 1 section need you' — the shipped copy, grammatically wrong.
    expect(deriveNextAction({ ...base, awaitingHuman: 1 }).label).toBe('Review — 1 section needs you');
    expect(deriveNextAction({ ...base, awaitingHuman: 2 }).label).toBe('Review — 2 sections need you');
  });

  /**
   * `auditsNeedingFix` counts STAGES (spec, plan) whose latest pass came back `revised`,
   * so its only values are 0, 1 and 2 — this used to be exercised with 3 and to assert
   * "Resolve 3 audit findings", a sentence the producer cannot generate and a unit
   * (`finding`) details does not store.
   */
  it('a revised audit wins over stage progress, but not over the human gate', () => {
    for (const n of [1, 2]) {
      expect(deriveNextAction({ ...base, auditsNeedingFix: n })).toEqual({
        label: 'Resolve audit findings',
        tone: 'attention',
      });
    }
    expect(deriveNextAction({ ...base, awaitingHuman: 1, auditsNeedingFix: 2 }).label).toContain('needs you');
  });

  it('stage-driven steps when unblocked', () => {
    expect(deriveNextAction({ ...base, currentStage: 'exploration' })).toEqual({ label: 'Continue exploration', tone: 'normal' });
    expect(deriveNextAction({ ...base, currentStage: 'spec' })).toEqual({ label: 'Continue spec', tone: 'normal' });
    expect(deriveNextAction({ ...base, phase: 'build' })).toEqual({ label: 'Build running', tone: 'info' });
    expect(deriveNextAction({ ...base, phase: 'learn' })).toEqual({ label: 'Learn', tone: 'done' });
  });
});
