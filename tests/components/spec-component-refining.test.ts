import { isComponentRefining } from '@/components/forge/SpecStageClient';

// QA (Spec refine, mirror of Plan F3) — the "Forge is thinking" bubble + composer lock must
// survive navigation: the local `refiningComponents` set is lost on remount, but mma.busyHandlers
// rehydrates the in-flight 'spec-refine' from /pending-handlers.
describe('isComponentRefining', () => {
  it('true when the component is in the local refining set', () => {
    expect(isComponentRefining('c1', new Set(['c1']), new Set())).toBe(true);
  });
  it('true when a spec-refine batch is in flight after a remount (local set empty)', () => {
    expect(isComponentRefining('c1', new Set(), new Set(['spec-refine']))).toBe(true);
  });
  it('false when neither local nor a spec-refine batch is in flight', () => {
    expect(isComponentRefining('c1', new Set(), new Set(['plan-refine', 'spec-audit']))).toBe(false);
  });
});
