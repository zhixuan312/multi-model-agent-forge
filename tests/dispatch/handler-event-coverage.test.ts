// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { HANDLER_EVENT, phaseKeyForHandler } from '@/details/project-event-labels';
import { ensureHandlersRegistered, getHandler } from '@/dispatch/handler-registry';

/**
 * `HANDLER_EVENT` documents itself as covering every handler ("none today" are absent),
 * and two things depend on that being TRUE rather than merely current:
 *
 *   1. the project activity timeline — a handler with no entry produces no line, so its
 *      work is invisible in the log;
 *   2. the G2 concurrency guard — `phaseKeyForHandler` returns `null` for an unmapped
 *      handler, and a null phase key is never guarded, so a double-dispatch of that
 *      handler is silently permitted.
 *
 * So this is checked, not asserted in prose. Registering a handler without an entry
 * fails here rather than quietly losing its timeline and its duplicate protection.
 */
const REGISTERED = [
  'spec-audit', 'plan-audit', 'spec-auto-draft', 'spec-refine', 'plan-author',
  'explore-propose', 'explore-synthesize', 'spec-audit-apply', 'plan-audit-apply',
  'plan-refine', 'execute-pipeline', 'code-review', 'review-apply',
  'journal-harvest', 'journal-record',
] as const;

describe('every registered MMA handler is mapped to a project event', () => {
  it('the list under test matches what ensureHandlersRegistered actually registers', async () => {
    // Guards the list above from drifting: a handler added to the registry and not here
    // would otherwise be checked by nothing at all.
    await ensureHandlersRegistered();
    for (const name of REGISTERED) {
      expect(getHandler(name), `${name} is listed here but not registered`).toBeDefined();
    }
  });

  it('has a label, stage and phase for each', () => {
    for (const name of REGISTERED) {
      const entry = HANDLER_EVENT[name];
      expect(entry, `${name} has no HANDLER_EVENT entry — its terminal writes no timeline line`).toBeDefined();
      expect(entry.label.length, `${name} has an empty label`).toBeGreaterThan(0);
      expect(entry.stage.length).toBeGreaterThan(0);
      expect(entry.phase.length).toBeGreaterThan(0);
    }
  });

  it('yields a phase key for each, so the duplicate-dispatch guard applies', () => {
    for (const name of REGISTERED) {
      expect(phaseKeyForHandler(name), `${name} is unguarded — G2 skips a null phase key`).not.toBeNull();
    }
  });

  it('maps nothing it does not register', () => {
    expect(Object.keys(HANDLER_EVENT).sort()).toEqual([...REGISTERED].sort());
  });
});
