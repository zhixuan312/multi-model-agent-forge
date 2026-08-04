// @vitest-environment jsdom
/**
 * The cancellation half of `dispatch.*` reaches the overlay.
 *
 * `PollManager` publishes a `cancelling` phase when a stop request lands and a terminal when
 * the batch really ends. Both existed and neither was consumed, so `AutomationOverlay` had
 * no way to tell "asked to stop" from "stopped" — it hid itself on the click and the engine
 * carried on committing.
 *
 * These assert the bridge, not the rendering: the right window event, carrying the batch id,
 * for exactly the frames that mean something to a stop.
 */
import { QueryClient } from '@tanstack/react-query';
import { applyProjectEvent } from '@/hooks/useProjectEvents';
import { CANCELLING_HEADLINE } from '@/sse/cancel-phase';
import type { ProjectEvent } from '@/sse/event-bus';

function captured(events: ProjectEvent[]): Array<{ type: string; batchId?: string }> {
  const seen: Array<{ type: string; batchId?: string }> = [];
  const record = (type: string) => (e: Event) =>
    seen.push({ type, batchId: (e as CustomEvent).detail?.batchId });
  const onCancelling = record('automation:cancelling');
  const onSettled = record('automation:dispatch_settled');
  window.addEventListener('automation:cancelling', onCancelling);
  window.addEventListener('automation:dispatch_settled', onSettled);
  try {
    const qc = new QueryClient();
    for (const e of events) applyProjectEvent(qc, 'p1', e);
  } finally {
    window.removeEventListener('automation:cancelling', onCancelling);
    window.removeEventListener('automation:dispatch_settled', onSettled);
  }
  return seen;
}

const progress = (phase: string): ProjectEvent =>
  ({ type: 'dispatch.progress', batchId: 'b1', handler: 'execute', phase, elapsedMs: 10 }) as ProjectEvent;

describe('dispatch cancellation bridge', () => {
  it('announces a batch that is cancelling', () => {
    expect(captured([progress(CANCELLING_HEADLINE)])).toEqual([
      { type: 'automation:cancelling', batchId: 'b1' },
    ]);
  });

  /**
   * The overlay counts pending stops. An ordinary progress frame arrives many times per
   * batch; if every one announced a cancellation, the set would fill with batches nobody
   * asked to stop and the overlay would never close.
   */
  it('stays silent for ordinary progress', () => {
    expect(captured([progress('implementing'), progress('reviewing')])).toEqual([]);
  });

  it('settles on every dispatch terminal, not just the cancelled one', () => {
    const terminals: ProjectEvent[] = [
      { type: 'dispatch.cancelled', batchId: 'b1', handler: 'execute', error: 'cancelled' },
      { type: 'dispatch.done', batchId: 'b2', handler: 'spec-audit' },
      { type: 'dispatch.failed', batchId: 'b3', handler: 'plan-author', error: 'boom' },
    ] as ProjectEvent[];
    // `done`/`failed` matter as much as `cancelled`: a batch that finishes NORMALLY in the
    // race with a stop request is just as settled, and waiting only for `cancelled` would
    // hold the overlay open forever on the one that won.
    expect(captured(terminals).map((s) => s.batchId)).toEqual(['b1', 'b2', 'b3']);
    expect(captured(terminals).every((s) => s.type === 'automation:dispatch_settled')).toBe(true);
  });

  it('carries the batch id — without it the overlay cannot match a settle to a stop', () => {
    const [only] = captured([progress(CANCELLING_HEADLINE)]);
    expect(only.batchId).toBe('b1');
  });
});
