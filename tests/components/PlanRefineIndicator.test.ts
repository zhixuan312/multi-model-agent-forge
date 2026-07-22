import { isTaskRefining } from '@/components/forge/PlanStageClient';

// QA F3 — the per-task "Forge is refining" indicator + composer lock must survive navigation.
// The local `refiningTasks` set is lost on unmount; on remount mma.busyHandlers rehydrates
// the in-flight 'plan-refine' from /pending-handlers, so the indicator must key off both.
describe('isTaskRefining', () => {
  it('true when the task is in the local refining set', () => {
    expect(isTaskRefining('t1', new Set(['t1']), new Set())).toBe(true);
  });
  it('true when a plan-refine batch is in flight after a remount (local set empty)', () => {
    expect(isTaskRefining('t1', new Set(), new Set(['plan-refine']))).toBe(true);
  });
  it('false when neither local nor a plan-refine batch is in flight', () => {
    expect(isTaskRefining('t1', new Set(), new Set(['spec-audit', 'plan-audit']))).toBe(false);
  });
});
