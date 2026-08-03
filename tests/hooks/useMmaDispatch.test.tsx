import { vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMmaDispatch } from '@/hooks/useMmaDispatch';

/**
 * The two halves of a dispatch — the POST and the SSE frame that settles it — travel over
 * separate connections and race each other. These tests hold the POST open so the frame
 * arrives FIRST, which is the ordering the hook used to lose.
 */

/** A fake EventSource whose frames the test delivers by hand. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  close() {
    this.closed = true;
  }
  /** Deliver one SSE frame, as the browser would. */
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const okResponse = () => ({ ok: true, status: 200, json: async () => ({}) }) as Response;

beforeEach(() => {
  FakeEventSource.last = null;
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  // The mount-time /pending-handlers probe; individual tests re-stub for their own call.
  vi.stubGlobal('fetch', vi.fn(async () => okResponse()));
});
afterEach(() => vi.unstubAllGlobals());

describe('useMmaDispatch — the SSE frame can beat the POST response', () => {
  /**
   * `dispatch`/`transition` registered their waiter AFTER awaiting the POST. The stream is
   * already open, so a `dispatch.done` published as the server responds can arrive first —
   * and then the resolve had nothing to resolve. `clearBusy` still ran, so the UI looked
   * idle, while everything chained after `await mma.transition(...)` never ran at all.
   */
  it('settles a transition whose done frame arrives before the POST resolves', async () => {
    const post = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      String(url).includes('/transition') ? post.promise : Promise.resolve(okResponse()),
    ));

    const { result } = renderHook(() => useMmaDispatch('p1'));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());

    let settled = false;
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.transition('run_audit', {}, 'spec-audit').then(() => { settled = true; });
    });

    // The frame lands while the POST is still in flight.
    await act(async () => {
      FakeEventSource.last!.emit({ type: 'dispatch.done', handler: 'spec-audit' });
      post.resolve(okResponse());
      await pending;
    });

    expect(settled).toBe(true);
  });

  it('settles a dispatch in the same ordering', async () => {
    const post = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      String(url).includes('pending-handlers') ? Promise.resolve(okResponse()) : post.promise,
    ));

    const { result } = renderHook(() => useMmaDispatch('p1'));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());

    let settled = false;
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.dispatch('/api/x', 'explore-propose').then(() => { settled = true; });
    });
    await act(async () => {
      FakeEventSource.last!.emit({ type: 'dispatch.done', handler: 'explore-propose' });
      post.resolve(okResponse());
      await pending;
    });

    expect(settled).toBe(true);
  });
});

describe('useMmaDispatch — what a failure rejects WITH', () => {
  /**
   * The HTTP path rejects with an `Error`; the SSE path rejected with a bare string. Every
   * consumer is written `e instanceof Error ? e.message : '<generic>'`, so the server's
   * actual reason — the whole point of putting it on the frame — was replaced by the
   * fallback at every call site.
   */
  it('rejects with an Error carrying the server’s message, not a bare string', async () => {
    const { result } = renderHook(() => useMmaDispatch('p1'));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());

    let caught: unknown;
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.transition('run_audit', {}, 'spec-audit').catch((e: unknown) => { caught = e; });
    });
    await act(async () => {
      FakeEventSource.last!.emit({
        type: 'dispatch.failed',
        handler: 'spec-audit',
        error: 'MMA rejected the request: no provider configured.',
      });
      await pending;
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('MMA rejected the request: no provider configured.');
  });

  it('rejects a cancellation with an Error too', async () => {
    const { result } = renderHook(() => useMmaDispatch('p1'));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());

    let caught: unknown;
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.waitFor('code-review').catch((e: unknown) => { caught = e; });
    });
    await act(async () => {
      FakeEventSource.last!.emit({ type: 'dispatch.cancelled', handler: 'code-review', error: 'Stopped by you.' });
      await pending;
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Stopped by you.');
  });

  /**
   * A failed POST drops the waiter. Leaving it registered means the NEXT frame for that
   * handler — from an unrelated later dispatch — settles a caller that already rejected.
   */
  it('drops the waiter when the POST itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('pending-handlers')
        ? okResponse()
        : ({ ok: false, status: 500, json: async () => ({ error: 'boom' }), text: async () => 'boom' } as Response),
    ));

    const { result } = renderHook(() => useMmaDispatch('p1'));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());

    await act(async () => {
      await expect(result.current.transition('run_audit', {}, 'spec-audit')).rejects.toThrow();
    });

    // A late frame for the same handler must find nothing to settle.
    expect(() =>
      FakeEventSource.last!.emit({ type: 'dispatch.done', handler: 'spec-audit' }),
    ).not.toThrow();
    await waitFor(() => expect(result.current.busyHandlers.has('spec-audit')).toBe(false));
  });
});
