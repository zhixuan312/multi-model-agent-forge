// @vitest-environment node
import { computeAllStages, type StageRow } from '@/projects/stage-lifecycle';

/**
 * Regression guard for the page-render-mutates-stage bug.
 *
 * Viewing/refreshing a stage URL used to call `ensureStageReached`, which WROTE the
 * DB — force-marking prior stages `done` and the viewed stage `active`. During an
 * auto run that clobbered the driver's in-progress work and jumped the pipeline out
 * of order (e.g. a stale `/review` tab refreshed while the driver was mid-`plan`
 * jumped straight to review→journal, skipping refine/audit/execute).
 *
 * The writer is gone: a stage-page render is now strictly READ-ONLY. The stepper's
 * "this stage is reached" appearance is computed by `computeAllStages` from the
 * ACTUAL (unchanged) DB state + the viewed stage — no mutation required. These tests
 * assert that render is correct WITHOUT any DB write, i.e. the real DB state that the
 * driver owns is what drives the stepper.
 */
function makeRows(statuses: Record<string, string>): StageRow[] {
  return (['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const).map((kind) => ({
    kind,
    status: (statuses[kind] ?? 'pending') as StageRow['status'],
  }));
}

const visualOf = (r: ReturnType<typeof computeAllStages>, kind: string) =>
  r.find((s) => s.kind === kind)!.visual;

describe('stage stepper is read-only (page render never mutates stage state)', () => {
  it('THE BUG: refreshing a stale /review URL while the driver is mid-plan does NOT change the pipeline', () => {
    // The real DB state the driver owns: plan is active (mid plan-refine), everything
    // downstream still pending. This is exactly what it stays as on a page refresh —
    // no write happens.
    const realDbState = makeRows({ exploration: 'done', spec: 'done', plan: 'active' });

    // Viewing /review renders the stepper from that UNCHANGED state. The stepper may
    // show the path optimistically, but the DB (source of truth) is untouched: plan
    // is still ongoing, execute/review/journal still not reached.
    const stepper = computeAllStages(realDbState, 'review');
    expect(visualOf(stepper, 'plan')).toBe('done');       // implicit-done up to viewed stage (display only)
    expect(visualOf(stepper, 'review')).toBe('ongoing');  // the viewed stage highlights
    // Critical: the driver's real state is not advanced — journal never shows reached
    // off a stale review view, and reachability is bounded by the true furthest stage.
    expect(visualOf(stepper, 'journal')).toBe('not_started');
    expect(stepper.find((s) => s.kind === 'journal')!.reachable).toBe(false);
  });

  it('stepper reflects the DRIVER\'s real progress, not the viewed URL', () => {
    // Driver has genuinely reached review (execute done, review active).
    const realDbState = makeRows({
      exploration: 'done', spec: 'done', plan: 'done', execute: 'done', review: 'active',
    });
    // Even while viewing an EARLIER stage (spec), the true progress shows through.
    const stepper = computeAllStages(realDbState, 'spec');
    expect(visualOf(stepper, 'execute')).toBe('done');
    expect(visualOf(stepper, 'review')).toBe('ongoing');
    expect(stepper.find((s) => s.kind === 'spec')!.isCurrent).toBe(true);
    // All genuinely-reached stages stay reachable for navigation.
    expect(stepper.filter((s) => s.reachable).map((s) => s.kind)).toEqual([
      'exploration', 'spec', 'plan', 'execute', 'review',
    ]);
  });

  it('no viewing stage (null) → purely the driver\'s DB state', () => {
    const stepper = computeAllStages(makeRows({ exploration: 'done', spec: 'active' }), null);
    expect(visualOf(stepper, 'spec')).toBe('ongoing');
    expect(visualOf(stepper, 'plan')).toBe('not_started');
  });
});
