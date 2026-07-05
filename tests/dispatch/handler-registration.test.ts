import { ensureHandlersRegistered, getHandler } from '@/dispatch/handler-registry';

/**
 * Regression: `ensureHandlersRegistered` fired 16 un-awaited dynamic imports and
 * returned void, so a caller that read `getHandler` on the next synchronous line
 * (the dispatch await:true path) got `undefined` on a cold module — a batch-backed
 * dispatch then recorded no gating state and re-dispatched forever. The contract
 * now: it returns a promise that resolves only once every handler is registered.
 */
describe('handler registration is awaitable (no cold-start race)', () => {
  it('returns a promise; every batch handler is registered once awaited', async () => {
    const p = ensureHandlersRegistered();
    expect(typeof p.then).toBe('function');
    await p;
    for (const key of [
      'spec-audit', 'plan-audit', 'spec-audit-apply', 'plan-audit-apply',
      'spec-auto-draft', 'spec-refine', 'plan-author', 'plan-refine',
      'explore-propose', 'explore-synthesize', 'spec-learnings',
      'execute-pipeline', 'code-review', 'review-apply',
      'journal-harvest', 'journal-record',
    ]) {
      expect(getHandler(key), `handler '${key}' must be registered after await`).toBeDefined();
    }
  });

  it('is memoized — repeated calls return the same promise', () => {
    expect(ensureHandlersRegistered()).toBe(ensureHandlersRegistered());
  });
});
