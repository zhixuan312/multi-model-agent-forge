// @vitest-environment node
import { describe, it, expect } from 'vitest';

/**
 * Handler REGISTRATION for the spec chat surface.
 *
 * This file used to claim it tested "DB persistence, SSE event publishing, and the full
 * message lifecycle through the dispatch handlers". It did not:
 *
 * - its two handler cases only asserted `getHandler(...)` was defined — the handlers were
 *   never invoked and no published event was ever inspected;
 * - its "publishes correct event shape" cases BUILT an event literal inside the test,
 *   asserted that literal carried the fields just written into it, then pushed to the
 *   captured array by hand and asserted the push. No production code ran;
 * - its "client-side lifecycle" case DEFINED an `onSseMessage` inside the test and
 *   exercised that copy. The real skip-own/dedup logic lives inline in `SpecStageClient`
 *   (`seenMsgIds`, `authorId === currentMember.id`), so the test was a re-implementation —
 *   it would keep passing while the component it mirrored broke.
 *
 * The handler's real behaviour is now covered by `spec-refine-handler.test.ts`, which
 * invokes it through the registry and asserts the row it inserts, the event it publishes,
 * and the spec.md it splices. What remains here is the one thing this file legitimately
 * proved: the handlers are wired into the registry at import time.
 */
describe('spec chat handlers register through ensureHandlersRegistered', () => {
  it.each(['spec-auto-draft', 'spec-refine'])('%s resolves once registration settles', async (key) => {
    // `ensureHandlersRegistered()` is the documented contract — handlers self-register on
    // module import, so reading the registry before those imports resolve returns undefined
    // and a batch-backed dispatch records no gating state and re-dispatches forever. Awaiting
    // it here is the same thing the dispatch layer must do.
    const { ensureHandlersRegistered, getHandler } = await import('@/dispatch/handler-registry');
    await ensureHandlersRegistered();
    expect(getHandler(key)).toBeTypeOf('function');
  });
});
