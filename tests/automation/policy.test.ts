import { canAutoStart } from '@/automation/policy';
import { buildInitialDetails } from '@/details/schema';

describe('canAutoStart — auto entry gated to spec/finalize+ (AC12)', () => {
  function at(stage: 'spec-outline' | 'spec-finalize' | 'plan' | 'journal') {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    if (stage === 'spec-outline') {
      d.stages.spec.status = 'active';
      d.stages.spec.phases.outline.status = 'active';
    } else if (stage === 'spec-finalize') {
      d.stages.spec.status = 'active';
      d.stages.spec.phases.finalize.status = 'active';
    } else {
      d.stages.spec.status = 'done';
      d.stages[stage].status = 'active';
    }
    return d;
  }

  it('rejects before spec/finalize (Design phases are hand-authored)', () => {
    expect(canAutoStart(at('spec-outline'))).toBe(false);
  });
  it('permits at spec/finalize', () => {
    expect(canAutoStart(at('spec-finalize'))).toBe(true);
  });
  it('permits at plan and later stages', () => {
    expect(canAutoStart(at('plan'))).toBe(true);
    expect(canAutoStart(at('journal'))).toBe(true);
  });
});
