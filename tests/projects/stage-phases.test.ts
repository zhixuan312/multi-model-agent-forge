// @vitest-environment node
import { STAGE_PHASES, parseStagePhase, stagePhaseKeys } from '@/projects/stage-phases';
import { buildInitialDetails } from '@/details/schema';
import { STAGE_KIND } from '@/db/enums';

/**
 * The sub-phase keys the UI shows must be the sub-phase keys the project details actually
 * hold. They are two hand-maintained lists of the same taxonomy, and nothing compared them.
 *
 * AutomationOverlay carried a THIRD copy — a `phases` array per stage — which had drifted
 * to `monitor` for execute where every server-side definition says `implement`. It went
 * unnoticed for the simplest possible reason: nothing read it. Four stage pages then
 * carried a FOURTH through SEVENTH as their `?phase=` validators. All are gone;
 * `STAGE_PHASES` is the one list, and this pins it against the storage schema.
 */
describe('stage phases match the details schema', () => {
  const details = buildInitialDetails();

  it('covers a real taxonomy — an empty map must not pass vacuously', () => {
    expect(Object.keys(STAGE_PHASES).length).toBe(6);
    expect(STAGE_KIND.length).toBe(6);
  });

  for (const kind of STAGE_KIND) {
    /**
     * BOTH directions. "Every UI phase exists in the schema" alone would have passed the
     * shape that keeps recurring: a value the data can hold and the control cannot offer
     * (the usage table's phase filter listed 3 of `PROJECT_PHASE`'s 4 members, so a
     * completed project was visible in the table and unreachable from the dropdown).
     * A phase that `details` can mark `active` and the stepper cannot draw is that bug
     * with different nouns.
     */
    it(`${kind}: the UI phase list and details.stages.${kind}.phases are the same set`, () => {
      const stage = details.stages[kind] as { phases: Record<string, unknown> };
      expect([...stagePhaseKeys(kind)].sort()).toEqual(Object.keys(stage.phases).sort());
    });
  }

  it('execute names `implement`, not `monitor` — the key every server module uses', () => {
    expect(stagePhaseKeys('execute')).toEqual(['configure', 'implement']);
  });

  it('is ordered, not just complete — the stepper draws it left to right', () => {
    expect(stagePhaseKeys('exploration')).toEqual(['brief', 'discover', 'synthesize']);
    expect(stagePhaseKeys('spec')).toEqual(['outline', 'craft', 'finalize']);
  });
});

describe('parseStagePhase', () => {
  it('accepts a phase that belongs to the stage', () => {
    expect(parseStagePhase('journal', 'summary')).toBe('summary');
    expect(parseStagePhase('exploration', 'discover')).toBe('discover');
  });

  /**
   * The Reflect page cast `?phase=` straight to `'journal' | 'summary'`. Because the page
   * then used `phaseFromUrl ?? activePhase`, a junk value did not merely fail to select a
   * view — it BEAT the stage's real active phase, so a project whose summary was ready
   * landed on the learnings list with nothing lit in the stepper.
   */
  it('rejects a phase that belongs to a DIFFERENT stage', () => {
    expect(parseStagePhase('journal', 'discover')).toBeUndefined();
    expect(parseStagePhase('plan', 'craft')).toBeUndefined();
  });

  it('rejects junk, empty, and absent values', () => {
    for (const raw of ['nope', '', ' summary', 'SUMMARY', null, undefined]) {
      expect(parseStagePhase('journal', raw), JSON.stringify(raw)).toBeUndefined();
    }
  });
});
