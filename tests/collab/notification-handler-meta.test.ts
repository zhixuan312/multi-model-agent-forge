// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { HANDLER_EVENT } from '@/details/project-event-labels';
import { STAGE_LABEL } from '@/projects/stage-lifecycle';
import { notificationMetaForTest } from '@/collab/notification-store';

/**
 * A dispatch-failure notification names the stage and phase the work belonged to. The
 * stage names were hand-written and said "Journal" where every other surface says
 * "Reflect" — so a failed harvest told the user about a stage that appears nowhere in the
 * UI — and `plan-refine` was missing entirely, rendering stage "?" and phase "?".
 */
describe('notification metadata covers every handler and names stages canonically', () => {
  const handlers = Object.keys(HANDLER_EVENT);

  it('resolves a real stage and phase for every registered handler', () => {
    expect(handlers.length).toBeGreaterThan(10);
    for (const h of handlers) {
      const meta = notificationMetaForTest(h);
      expect(meta.stage, `${h} has no stage`).not.toBe('?');
      expect(meta.phase, `${h} has no phase`).not.toBe('?');
      expect(meta.activity).not.toBe('');
    }
  });

  it('uses the canonical display name for each stage', () => {
    for (const h of handlers) {
      const kind = HANDLER_EVENT[h].stage as keyof typeof STAGE_LABEL;
      expect(notificationMetaForTest(h).stage, h).toBe(STAGE_LABEL[kind]);
    }
  });

  it('says Reflect, never Journal, for the journal handlers', () => {
    expect(notificationMetaForTest('journal-harvest').stage).toBe('Reflect');
    expect(notificationMetaForTest('journal-record').stage).toBe('Reflect');
  });
});
