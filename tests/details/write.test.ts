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

  it('setBriefText sets text and marks phase done', () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.brief.text = 'my idea';
    d.stages.exploration.phases.brief.status = 'done';

    const validated = validateDetails(d);
    expect(validated.stages.exploration.phases.brief.text).toBe('my idea');
    expect(validated.stages.exploration.phases.brief.status).toBe('done');
  });
});
