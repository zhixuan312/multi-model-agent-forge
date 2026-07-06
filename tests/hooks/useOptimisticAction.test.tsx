import { vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';

// Contract test for the single optimistic-update primitive (spec §4.2, OA-1..OA-9).
// showToast is the single failure/confirmation channel; we mock it to capture calls.

const toasts: Array<{ type: string; message: string; retry?: () => void }> = [];
vi.mock('@/components/ui/toast', () => ({
  showToast: (t: { type: string; message: string; retry?: () => void }) => { toasts.push(t); },
}));

beforeEach(() => { toasts.length = 0; });

/** A promise you resolve/reject by hand — to hold `commit` in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('useOptimisticAction', () => {
  it('OA-1: calls apply() before commit() resolves', async () => {
    const order: string[] = [];
    const { result } = renderHook(() => useOptimisticAction());
    await act(async () => {
      await result.current.run({
        apply: () => order.push('apply'),
        commit: async () => { order.push('commit'); },
        rollback: () => order.push('rollback'),
        error: 'nope',
      });
    });
    expect(order).toEqual(['apply', 'commit']);
    expect(order).not.toContain('rollback');
  });

  it('OA-2: success shows optional success toast, runs onSettled, never rolls back', async () => {
    const onSettled = vi.fn();
    const rollback = vi.fn();
    const { result } = renderHook(() => useOptimisticAction());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.run({
        apply: () => {},
        commit: async () => 42,
        rollback,
        success: 'Saved.',
        error: 'nope',
        onSettled,
      });
    });
    expect(returned).toBe(42);
    expect(onSettled).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    expect(toasts).toEqual([{ type: 'success', message: 'Saved.' }]);
  });

  it('OA-2: a throwing onSettled still resolves success and logs (no toast, no rollback)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rollback = vi.fn();
    const { result } = renderHook(() => useOptimisticAction());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.run({
        apply: () => {}, commit: async () => 'ok', rollback,
        error: 'nope', onSettled: () => { throw new Error('refresh boom'); },
      });
    });
    expect(returned).toBe('ok');
    expect(rollback).not.toHaveBeenCalled();
    expect(toasts.filter((t) => t.type === 'error')).toHaveLength(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('OA-3: commit rejection rolls back, shows an error toast, resolves undefined (no throw)', async () => {
    const rollback = vi.fn();
    const { result } = renderHook(() => useOptimisticAction());
    let returned: unknown = 'sentinel';
    await act(async () => {
      returned = await result.current.run({
        apply: () => {}, commit: async () => { throw new Error('server 500'); }, rollback,
        error: 'Could not save — reverted.',
      });
    });
    expect(returned).toBeUndefined();
    expect(rollback).toHaveBeenCalledOnce();
    expect(toasts).toEqual([{ type: 'error', message: 'Could not save — reverted.', retry: undefined }]);
  });

  it('OA-5: a function error message is computed from the throw and sanitized', async () => {
    const { result } = renderHook(() => useOptimisticAction());
    await act(async () => {
      await result.current.run({
        apply: () => {}, commit: async () => { throw new Error('boom token=a1b2c3d4e5f6a7b8c9d0e1f2'); },
        rollback: () => {},
        error: (e) => `Failed: ${(e as Error).message}`,
      });
    });
    const msg = toasts[0]!.message;
    expect(msg).toContain('«redacted»');
    expect(msg).not.toMatch(/a1b2c3d4e5f6/);
  });

  it('retryable:true attaches a Retry that re-invokes; retryable omitted → no Retry', async () => {
    const { result } = renderHook(() => useOptimisticAction());
    const commit = vi.fn(async () => { throw new Error('x'); });
    await act(async () => {
      await result.current.run({ apply: () => {}, commit, rollback: () => {}, error: 'e', retryable: true });
    });
    expect(typeof toasts[0]!.retry).toBe('function');
    await act(async () => { toasts[0]!.retry!(); });
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));

    toasts.length = 0;
    await act(async () => {
      await result.current.run({ apply: () => {}, commit: async () => { throw new Error('y'); }, rollback: () => {}, error: 'e2' });
    });
    expect(toasts[0]!.retry).toBeUndefined();
  });

  it('OA-7: Retry after unmount is a no-op', async () => {
    const { result, unmount } = renderHook(() => useOptimisticAction());
    const commit = vi.fn(async () => { throw new Error('x'); });
    await act(async () => {
      await result.current.run({ apply: () => {}, commit, rollback: () => {}, error: 'e', retryable: true });
    });
    const retry = toasts[0]!.retry!;
    unmount();
    await act(async () => { retry(); });
    // still only the original attempt — no re-invoke after unmount
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('OA-8: apply() throwing skips commit, toasts (non-retryable), resolves undefined', async () => {
    const commit = vi.fn(async () => 'never');
    const { result } = renderHook(() => useOptimisticAction());
    let returned: unknown = 'sentinel';
    await act(async () => {
      returned = await result.current.run({
        apply: () => { throw new Error('apply boom'); },
        commit, rollback: () => {}, error: 'Could not start.', retryable: true,
      });
    });
    expect(commit).not.toHaveBeenCalled();
    expect(returned).toBeUndefined();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.type).toBe('error');
    expect(toasts[0]!.retry).toBeUndefined(); // forced non-retryable on apply-throw
  });

  it('OA-8: rollback() throwing still toasts and calls resync (no Retry)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resync = vi.fn();
    const { result } = renderHook(() => useOptimisticAction());
    await act(async () => {
      await result.current.run({
        apply: () => {}, commit: async () => { throw new Error('commit boom'); },
        rollback: () => { throw new Error('rollback boom'); },
        error: 'Could not save.', retryable: true, resync,
      });
    });
    expect(resync).toHaveBeenCalledOnce();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.type).toBe('error');
    expect(toasts[0]!.retry).toBeUndefined(); // broken rollback ⇒ no Retry
    spy.mockRestore();
  });

  it('OA-4/OA-9: pending is true while a commit is in flight, false after it settles', async () => {
    const d = deferred<string>();
    const { result } = renderHook(() => useOptimisticAction());
    expect(result.current.pending).toBe(false);
    let p!: Promise<unknown>;
    await act(async () => {
      p = result.current.run({ apply: () => {}, commit: () => d.promise, rollback: () => {}, error: 'e' });
    });
    expect(result.current.pending).toBe(true);
    await act(async () => { d.resolve('done'); await p; });
    expect(result.current.pending).toBe(false);
  });
});
