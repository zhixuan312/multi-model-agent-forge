// @vitest-environment node
import { STAGE_SUBSTEPS } from '@/components/forge/stage-substeps';
import { buildInitialDetails } from '@/details/schema';
import { STAGE_KIND, type StageKind } from '@/db/enums';

/**
 * The sub-phase keys the UI shows must be the sub-phase keys the project details actually
 * hold. They are two hand-maintained lists of the same taxonomy, and nothing compared them.
 *
 * AutomationOverlay carried a THIRD copy — a `phases` array per stage — which had drifted
 * to `monitor` for execute where every server-side definition says `implement`. It went
 * unnoticed for the simplest possible reason: nothing read it. That copy is gone, and this
 * pins the two that remain against each other.
 */
describe('stage sub-phase keys match the details schema', () => {
  const details = buildInitialDetails();

  it('covers a real taxonomy — an empty map must not pass vacuously', () => {
    expect(Object.keys(STAGE_SUBSTEPS).length).toBeGreaterThan(0);
    expect(STAGE_KIND.length).toBe(6);
  });

  for (const kind of STAGE_KIND) {
    const declared = STAGE_SUBSTEPS[kind as StageKind];
    if (!declared) continue;
    it(`${kind}: every UI sub-phase exists in details.stages.${kind}.phases`, () => {
      const stage = details.stages[kind as keyof typeof details.stages] as { phases?: Record<string, unknown> };
      const schemaKeys = Object.keys(stage.phases ?? {});
      const uiKeys = declared.map((s) => s.key);
      const unknown = uiKeys.filter((k) => !schemaKeys.includes(k));
      expect(unknown, `${kind} names sub-phases the details schema does not have`).toEqual([]);
    });
  }

  it('execute names `implement`, not `monitor` — the key every server module uses', () => {
    expect(STAGE_SUBSTEPS.execute?.map((s) => s.key)).toEqual(['configure', 'implement']);
  });
});
