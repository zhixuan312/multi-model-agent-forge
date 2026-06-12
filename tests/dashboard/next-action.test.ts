import { deriveNextAction } from '@/dashboard/next-action';

describe('deriveNextAction', () => {
  const base = { phase: 'design' as const, currentStage: 'spec' as const, awaitingHuman: 0, openAuditIssues: 0 };

  it('human gate wins over everything', () => {
    expect(deriveNextAction({ ...base, phase: 'build', awaitingHuman: 2 })).toEqual({
      label: 'Review — 2 sections need you',
      tone: 'attention',
    });
  });

  it('singular section copy', () => {
    expect(deriveNextAction({ ...base, awaitingHuman: 1 }).label).toBe('Review — 1 section need you');
  });

  it('audit findings win over stage progress (but not the human gate)', () => {
    expect(deriveNextAction({ ...base, openAuditIssues: 3 })).toEqual({
      label: 'Resolve 3 audit findings',
      tone: 'attention',
    });
    // human gate still outranks audit
    expect(deriveNextAction({ ...base, awaitingHuman: 1, openAuditIssues: 3 }).label).toContain('need you');
  });

  it('stage-driven steps when unblocked', () => {
    expect(deriveNextAction({ ...base, currentStage: 'exploration' })).toEqual({ label: 'Continue exploration', tone: 'normal' });
    expect(deriveNextAction({ ...base, currentStage: 'spec' })).toEqual({ label: 'Continue spec', tone: 'normal' });
    expect(deriveNextAction({ ...base, phase: 'frozen' })).toEqual({ label: 'Start the build', tone: 'normal' });
    expect(deriveNextAction({ ...base, phase: 'build' })).toEqual({ label: 'Build running', tone: 'info' });
    expect(deriveNextAction({ ...base, phase: 'done' })).toEqual({ label: 'Done', tone: 'done' });
  });
});
