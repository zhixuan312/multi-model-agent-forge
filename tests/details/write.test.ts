import { describe, it, expect } from 'vitest';
import { buildInitialDetails, validateDetails } from '@/details/schema';

describe('write helpers — unit logic', () => {
  it('advanceStage marks current active as done and activates target', () => {
    const d = buildInitialDetails();
    const now = new Date().toISOString();
    d.stages.exploration.status = 'done';
    d.stages.exploration.completedAt = now;
    for (const ph of Object.values(d.stages.exploration.phases)) {
      (ph as { status: string }).status = 'done';
    }
    d.stages.spec.status = 'active';
    d.stages.spec.startedAt = now;

    const validated = validateDetails(d);
    expect(validated.stages.exploration.status).toBe('done');
    expect(validated.stages.spec.status).toBe('active');
  });

  it('advancePhase marks current active phase as done and activates target', () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.brief.status = 'done';
    d.stages.exploration.phases.discover.status = 'active';
    d.stages.exploration.phases.discover.status = 'done';
    d.stages.exploration.phases.synthesize.status = 'active';

    const validated = validateDetails(d);
    expect(validated.stages.exploration.phases.discover.status).toBe('done');
    expect(validated.stages.exploration.phases.synthesize.status).toBe('active');
  });

  it('setAutomationStatus to running sets startedAt and clears stoppedAt', () => {
    const d = buildInitialDetails();
    d.automation.status = 'running';
    d.automation.startedAt = new Date().toISOString();
    d.automation.stoppedAt = undefined;

    const validated = validateDetails(d);
    expect(validated.automation.status).toBe('running');
    expect(validated.automation.startedAt).toBeTruthy();
  });

  it('saving brief text keeps the phase active (content edit, not a phase completion)', () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.brief.text = 'my idea';

    const validated = validateDetails(d);
    expect(validated.stages.exploration.phases.brief.text).toBe('my idea');
    // Saving the brain-dump does NOT complete the brief phase — only advance_phase
    // ("Continue to Discover") does. Brief stays active so propose_discover_tasks works.
    expect(validated.stages.exploration.phases.brief.status).toBe('active');
  });
});
