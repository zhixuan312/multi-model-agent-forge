// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildInitialDetails, validateDetails, type Details } from '@/details/schema';
import { advanceStage, advancePhase, setAutomationStatus, setBriefText } from '@/details/write';
import { createMockDb } from '../test-utils/mock-db';

/**
 * The write helpers, actually invoked.
 *
 * This file used to be titled "write helpers — unit logic" with cases named
 * `advanceStage`, `advancePhase` and `setAutomationStatus` — and it imported NONE of them.
 * Each case mutated a details object by hand and then asserted the values it had just
 * assigned, e.g. setting `spec.status = 'active'` and asserting `spec.status === 'active'`.
 * That exercised `validateDetails` round-tripping, not the helpers.
 *
 * It mattered because every OTHER reference to these functions in the suite is a
 * `vi.mock` stub. `advanceStage` is reached indirectly by `perform-transition`'s
 * hop-over case, but `advancePhase` and `setAutomationStatus` had no real coverage
 * anywhere — behind a file named `write.test.ts`.
 *
 * These call the helpers against a mock db and assert the details they persist.
 */
function dbWith(d: Details) {
  return createMockDb({
    'select:project': [{ details: d, detailsVersion: 0 }],
    'update:project': [{ id: 'p1' }],
  });
}

/** The details document the helper wrote through `updateDetails`. */
function written(db: ReturnType<typeof createMockDb>): Details {
  const set = db._callsFor('project').find((c) => c.method === 'set');
  return validateDetails((set!.args[0] as { details: unknown }).details);
}

describe('advanceStage', () => {
  it('completes the active stage AND all of its phases, then activates the target', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'active';
    d.stages.exploration.phases.brief.status = 'active';
    const db = dbWith(d);

    return advanceStage(db, 'p1', 'spec').then(() => {
      const out = written(db);
      expect(out.stages.exploration.status).toBe('done');
      // Every phase is closed — a stage left mid-phase is what stranded projects before.
      for (const ph of Object.values(out.stages.exploration.phases as Record<string, { status: string }>)) {
        expect(ph.status).toBe('done');
      }
      expect(out.stages.spec.status).toBe('active');
      expect(out.stages.exploration.completedAt).toBeTruthy();
      expect(out.stages.spec.startedAt).toBeTruthy();
    });
  });

  it('activates the target stage FIRST phase, so the resolver enters its branch', async () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'active';
    const db = dbWith(d);
    await advanceStage(db, 'p1', 'spec');
    expect(written(db).stages.spec.phases.outline.status).toBe('active');
  });

  it('HOPS OVER a skipped stage rather than activating it', async () => {
    // A subset run marks execute/review skipped; advancing to execute must land on the
    // next stage that is actually in scope, never re-open a skipped one.
    const d = buildInitialDetails();
    d.stages.plan.status = 'active';
    d.stages.execute.status = 'skipped';
    d.stages.review.status = 'skipped';
    const db = dbWith(d);
    await advanceStage(db, 'p1', 'execute');
    const out = written(db);
    expect(out.stages.execute.status).toBe('skipped');
    expect(out.stages.review.status).toBe('skipped');
    expect(out.stages.journal.status).toBe('active');
  });

  it('does not overwrite an existing completedAt/startedAt', async () => {
    const EARLIER = '2026-01-01T00:00:00.000Z';
    const d = buildInitialDetails();
    d.stages.exploration.status = 'active';
    d.stages.exploration.completedAt = EARLIER;
    d.stages.spec.startedAt = EARLIER;
    const db = dbWith(d);
    await advanceStage(db, 'p1', 'spec');
    const out = written(db);
    expect(out.stages.exploration.completedAt).toBe(EARLIER);
    expect(out.stages.spec.startedAt).toBe(EARLIER);
  });
});

describe('advancePhase', () => {
  it('closes the active phase and activates the named one', async () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.brief.status = 'active';
    const db = dbWith(d);
    await advancePhase(db, 'p1', 'exploration', 'discover');
    const out = written(db);
    expect(out.stages.exploration.phases.brief.status).toBe('done');
    expect(out.stages.exploration.phases.discover.status).toBe('active');
  });

  it('leaves already-done phases alone and is a no-op for an unknown phase name', async () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.brief.status = 'done';
    d.stages.exploration.phases.discover.status = 'active';
    const db = dbWith(d);
    await advancePhase(db, 'p1', 'exploration', 'not-a-phase');
    const out = written(db);
    expect(out.stages.exploration.phases.brief.status).toBe('done');
    // The active phase is still closed; nothing new is activated.
    expect(out.stages.exploration.phases.discover.status).toBe('done');
    expect(out.stages.exploration.phases.synthesize.status).toBe('pending');
  });
});

describe('setAutomationStatus', () => {
  it('running stamps startedAt and CLEARS a previous stoppedAt', async () => {
    const d = buildInitialDetails();
    d.automation.stoppedAt = '2026-01-01T00:00:00.000Z';
    const db = dbWith(d);
    await setAutomationStatus(db, 'p1', 'running');
    const out = written(db);
    expect(out.automation.status).toBe('running');
    expect(out.automation.startedAt).toBeTruthy();
    expect(out.automation.stoppedAt).toBeUndefined();
  });

  it('off stamps stoppedAt and leaves startedAt intact', async () => {
    const STARTED = '2026-01-01T00:00:00.000Z';
    const d = buildInitialDetails();
    d.automation.status = 'running';
    d.automation.startedAt = STARTED;
    const db = dbWith(d);
    await setAutomationStatus(db, 'p1', 'off');
    const out = written(db);
    expect(out.automation.status).toBe('off');
    expect(out.automation.stoppedAt).toBeTruthy();
    expect(out.automation.startedAt).toBe(STARTED);
  });
});

describe('setBriefText', () => {
  it('saves the text WITHOUT completing the brief phase', async () => {
    // A content edit, not a phase completion: the phase stays active so
    // propose_discover_tasks and further edits remain available until the human advances.
    const d = buildInitialDetails();
    const db = dbWith(d);
    await setBriefText(db, 'p1', 'my idea');
    const out = written(db);
    expect(out.stages.exploration.phases.brief.text).toBe('my idea');
    expect(out.stages.exploration.phases.brief.status).toBe('active');
  });
});
