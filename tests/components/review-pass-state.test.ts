// @vitest-environment node
import { reviewPassState } from '@/components/forge/ReviewStageClient';

describe('reviewPassState — Review pass display derivations (QA #2/#3)', () => {
  it('verdict is clean ONLY with zero findings', () => {
    expect(reviewPassState(0, []).verdict).toBe('clean');
    expect(reviewPassState(3, []).verdict).toBe('revised');
    // Medium/low-only findings must NOT read as clean — any finding count → revised.
    expect(reviewPassState(1, []).verdict).toBe('revised');
  });

  it('a subset apply is someApplied but NOT allApplied (grid stays actionable)', () => {
    const s = reviewPassState(4, [0, 2]);
    expect(s.someApplied).toBe(true);
    expect(s.allApplied).toBe(false);
    // The un-applied remainder is still selectable.
    expect(s.remainingIndices).toEqual([1, 3]);
  });

  it('allApplied only when every finding is applied', () => {
    expect(reviewPassState(3, [0, 1, 2]).allApplied).toBe(true);
    expect(reviewPassState(3, [0, 1, 2]).remainingIndices).toEqual([]);
  });

  it('zero findings is never someApplied/allApplied', () => {
    const s = reviewPassState(0, []);
    expect(s.someApplied).toBe(false);
    expect(s.allApplied).toBe(false);
    expect(s.remainingIndices).toEqual([]);
  });
});
