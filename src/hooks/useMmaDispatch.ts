'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { responseError } from '@/lib/err';

/**
 * useMmaDispatch — centralised hook for ALL MMA dispatch calls.
 *
 * Every stage uses the same pattern:
 *   const mma = useMmaDispatch(projectId, {
 *     onDone: {
 *       'explore-synthesize': () => refreshArtifact(),
 *       'explore-propose': () => refreshTasks(),
 *     },
 *   });
 *   await mma.dispatch(url, 'explore-synthesize');
 *   // ↑ resolves after SSE dispatch.done, AFTER onDone callback runs
 *
 * The hook handles: SSE connection, busy state, pending-handler recovery,
 * notification bell refresh on failure, and per-handler data refresh on success.
 *
 * Its EventSource is its own, separate from `useProjectEvents`' — see the note there.
 *
 * A `dispatch`/`transition`/`waitFor` promise settles only when the matching SSE frame
 * arrives. Two consequences worth knowing: a second call for the SAME handler replaces
 * the pending entry, so the first promise never settles; and a frame missed while the
 * stream was down leaves the caller waiting. The busy state is re-seeded from
 * `/pending-handlers` on mount, so a reload recovers either case.
 *
 * A third one is now handled rather than tolerated: the waiter is registered BEFORE the
 * POST, because the SSE frame races the POST's own response over the network and used to
 * be able to arrive first — dropping the settle entirely.
 */

export interface UseMmaDispatchOpts {
  initialBusy?: string[];
  /** Per-handler refresh callback — runs when dispatch.done fires for that handler. */
  onDone?: Record<string, () => void | Promise<void>>;
  /** Custom SSE event handlers (dispatch.progress, synthesis.updated, etc.). */
  events?: Record<string, (data: Record<string, unknown>) => void | Promise<void>>;
}

export interface MmaDispatchState {
  busy: boolean;
  busyHandlers: Set<string>;
  /** Synchronous ref — readable immediately after dispatch(), before React re-renders. */
  busyRef: React.RefObject<Set<string>>;
  error: string | null;
  dispatch: (url: string, handler: string, body?: unknown) => Promise<void>;
  /**
   * The unified lifecycle mutation: POST /transition { action, data }. Pass the MMA
   * `handler` an action dispatches (spec-audit, code-review, …) to track busy + wait
   * for its SSE dispatch.done; omit `handler` for instant actions (advance/approve),
   * which resolve as soon as the transition is accepted. Replaces the bespoke
   * per-route `dispatch(url, …)` calls (Task 9 route collapse).
   */
  transition: (action: string, data?: unknown, handler?: string) => Promise<void>;
  waitFor: (handler: string) => Promise<void>;
  clearError: () => void;
}

interface PendingDispatch {
  resolve: () => void;
  /**
   * An `Error`, not a string. The HTTP path already rejects with one, so the two halves of
   * the same function used to hand callers two different types — and every consumer is
   * written `e instanceof Error ? e.message : '<generic>'`, so the SSE half's message (the
   * server's actual reason for the failure) was thrown away in favour of the fallback at
   * every single call site.
   */
  reject: (err: Error) => void;
}

export function useMmaDispatch(projectId: string, opts?: UseMmaDispatchOpts): MmaDispatchState {
  const [busyHandlers, setBusyHandlers] = useState<Set<string>>(
    () => new Set(opts?.initialBusy ?? []),
  );
  const [error, setError] = useState<string | null>(null);
  const eventsRef = useRef(opts?.events);
  // eslint-disable-next-line react-hooks/refs -- intentional: mirror latest events callback into a ref so long-lived dispatch handlers read it without re-subscribing
  eventsRef.current = opts?.events;
  const onDoneRef = useRef(opts?.onDone);
  // eslint-disable-next-line react-hooks/refs -- intentional: mirror latest onDone callback into a ref so long-lived dispatch handlers read it without re-subscribing
  onDoneRef.current = opts?.onDone;

  const pendingRef = useRef<Map<string, PendingDispatch>>(new Map());
  const busyRef = useRef<Set<string>>(new Set(opts?.initialBusy ?? []));

  const markBusy = useCallback((handler: string) => {
    busyRef.current.add(handler);
    setBusyHandlers((prev) => new Set(prev).add(handler));
  }, []);

  const clearBusy = useCallback((handler: string) => {
    busyRef.current.delete(handler);
    setBusyHandlers((prev) => {
      const next = new Set(prev);
      next.delete(handler);
      return next;
    });
  }, []);

  // On mount: fetch pending handlers so the UI shows busy state for
  // in-flight batches dispatched before this page load.
  useEffect(() => {
    if (!projectId || opts?.initialBusy) return;
    fetch(`/api/projects/${projectId}/pending-handlers`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { handlers: string[] } | null) => {
        if (data) setBusyHandlers(new Set(data.handlers));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rehydrate once per project; `opts` is a fresh object literal every render, so depending on it would refetch on every parent re-render
  }, [projectId]);

  // Single SSE connection per project
  useEffect(() => {
    if (!projectId || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/projects/${projectId}/events`);

    es.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        const type = data.type as string;

        if (type === 'dispatch.done') {
          const handler = data.handler as string;
          clearBusy(handler);
          // Run the per-handler refresh callback, then resolve the promise
          const refresh = onDoneRef.current?.[handler];
          const pending = pendingRef.current.get(handler);
          if (refresh) {
            void Promise.resolve(refresh()).finally(() => {
              if (pending) { pendingRef.current.delete(handler); pending.resolve(); }
            });
          } else if (pending) {
            pendingRef.current.delete(handler);
            pending.resolve();
          }
        }

        if (type === 'dispatch.failed') {
          const handler = data.handler as string;
          const errorMsg = (data.error as string) ?? 'The operation failed.';
          clearBusy(handler);
          window.dispatchEvent(new CustomEvent('notification:refresh'));
          const pending = pendingRef.current.get(handler);
          if (pending) {
            pendingRef.current.delete(handler);
            pending.reject(new Error(errorMsg));
          }
        }

        // A deliberate stop, not a fault: clear the busy state and settle any waiter so
        // the control isn't stuck spinning — but no failure notification refresh.
        if (type === 'dispatch.cancelled') {
          const handler = data.handler as string;
          clearBusy(handler);
          const pending = pendingRef.current.get(handler);
          if (pending) {
            pendingRef.current.delete(handler);
            pending.reject(new Error((data.error as string) ?? 'Cancelled.'));
          }
        }

        const eventHandler = eventsRef.current?.[type];
        if (eventHandler) {
          void Promise.resolve(eventHandler(data));
        }
      } catch { /* ignore malformed SSE frames */ }
    };

    return () => es.close();
  }, [projectId, clearBusy]);

  /**
   * Register the waiter for `handler` and hand back its promise.
   *
   * Registration must happen BEFORE the POST, not after it. The SSE stream is already open,
   * so the server's `dispatch.*` frame and the POST's own HTTP response race each other over
   * the network — and when the frame wins, the old code had nothing registered yet. The
   * `resolve` was dropped on the floor, `pendingRef.set` then stored a waiter nothing would
   * ever settle, and the caller's `await mma.transition(...)` hung forever. Busy state
   * cleared, so the UI looked idle while everything chained after the await never ran.
   */
  const awaitHandler = useCallback((handler: string): Promise<void> => {
    const settled = new Promise<void>((resolve, reject) => {
      pendingRef.current.set(handler, { resolve, reject });
    });
    // The caller attaches its handler after the fetch resolves, which can be hundreds of
    // milliseconds later. Without this, a rejection arriving in that window is an unhandled
    // rejection in the console. The returned promise still rejects for the caller.
    settled.catch(() => {});
    return settled;
  }, []);

  const dispatch = useCallback(async (url: string, handler: string, body?: unknown) => {
    setError(null);
    markBusy(handler);
    const settled = awaitHandler(handler);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        throw new Error(await responseError(res, `Request failed (${res.status}).`));
      }
    } catch (e) {
      // Drop the waiter, or a later unrelated frame for this handler settles a caller that
      // has already been rejected.
      pendingRef.current.delete(handler);
      clearBusy(handler);
      const msg = e instanceof Error ? e.message : 'Dispatch failed.';
      setError(msg);
      throw e;
    }

    return settled;
  }, [markBusy, clearBusy, awaitHandler]);

  const transition = useCallback(async (action: string, data?: unknown, handler?: string): Promise<void> => {
    setError(null);
    if (handler) markBusy(handler);
    const settled = handler ? awaitHandler(handler) : null;
    try {
      const res = await fetch(`/api/projects/${projectId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data }),
      });
      if (!res.ok) {
        throw new Error(await responseError(res, `Request failed (${res.status}).`));
      }
    } catch (e) {
      if (handler) {
        pendingRef.current.delete(handler);
        clearBusy(handler);
      }
      const msg = e instanceof Error ? e.message : 'Transition failed.';
      setError(msg);
      throw e;
    }
    // Instant actions (advance/approve/select) have no MMA batch to await.
    return settled ?? undefined;
  }, [projectId, markBusy, clearBusy, awaitHandler]);

  const waitFor = useCallback((handler: string): Promise<void> => {
    markBusy(handler);
    return awaitHandler(handler);
  }, [markBusy, awaitHandler]);

  const clearError = useCallback(() => setError(null), []);

  return {
    busy: busyHandlers.size > 0,
    busyHandlers,
    busyRef,
    error,
    dispatch,
    transition,
    waitFor,
    clearError,
  };
}
