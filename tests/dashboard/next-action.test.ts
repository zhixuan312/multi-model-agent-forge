import { deriveNextAction } from '@/dashboard/next-action';
import { STAGE_LABEL } from '@/projects/stage-lifecycle';
import { STAGE_ORDER } from '@/db/enums';

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

  /**
   * Design spans exploration, spec AND plan. The branch only distinguished spec, so a
   * project on the plan stage was told to "Continue exploration" — the control tower
   * pointing two stages backwards for a third of the design phase. This test covered
   * exploration and spec and stopped exactly where the bug started.
   */
  it('names the plan stage rather than sending the user back to exploration', () => {
    expect(deriveNextAction({ ...base, currentStage: 'plan' })).toEqual({ label: 'Continue Plan', tone: 'normal' });
  });

  it('falls back to exploration only when there is no stage at all', () => {
    expect(deriveNextAction({ ...base, currentStage: null }).label).toBe('Continue Explore');
  });

  /** The words are the stepper's own (`STAGE_LABEL`), not a second set of stage nouns. */
  it('calls each stage what the rest of the product calls it', () => {
    for (const kind of STAGE_ORDER) {
      expect(deriveNextAction({ ...base, currentStage: kind }).label).toBe(`Continue ${STAGE_LABEL[kind]}`);
    }
  });

  it('stage-driven steps when unblocked', () => {
    expect(deriveNextAction({ ...base, currentStage: 'exploration' })).toEqual({ label: 'Continue Explore', tone: 'normal' });
    expect(deriveNextAction({ ...base, currentStage: 'spec' })).toEqual({ label: 'Continue Spec', tone: 'normal' });
    expect(deriveNextAction({ ...base, phase: 'build' })).toEqual({ label: 'Build running', tone: 'info' });
    expect(deriveNextAction({ ...base, phase: 'learn' })).toEqual({ label: 'Learn', tone: 'done' });
  });
});
