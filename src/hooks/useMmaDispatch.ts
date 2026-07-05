'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
  reject: (err: string) => void;
}

export function useMmaDispatch(projectId: string, opts?: UseMmaDispatchOpts): MmaDispatchState {
  const [busyHandlers, setBusyHandlers] = useState<Set<string>>(
    () => new Set(opts?.initialBusy ?? []),
  );
  const [error, setError] = useState<string | null>(null);
  const eventsRef = useRef(opts?.events);
  eventsRef.current = opts?.events;
  const onDoneRef = useRef(opts?.onDone);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
            pending.reject(errorMsg);
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

  const dispatch = useCallback(async (url: string, handler: string, body?: unknown) => {
    setError(null);
    markBusy(handler);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status}).`);
      }
    } catch (e) {
      clearBusy(handler);
      const msg = e instanceof Error ? e.message : 'Dispatch failed.';
      setError(msg);
      throw e;
    }

    return new Promise<void>((resolve, reject) => {
      pendingRef.current.set(handler, { resolve, reject });
    });
  }, [markBusy, clearBusy]);

  const transition = useCallback(async (action: string, data?: unknown, handler?: string): Promise<void> => {
    setError(null);
    if (handler) markBusy(handler);
    try {
      const res = await fetch(`/api/projects/${projectId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Request failed (${res.status}).`);
      }
    } catch (e) {
      if (handler) clearBusy(handler);
      const msg = e instanceof Error ? e.message : 'Transition failed.';
      setError(msg);
      throw e;
    }
    // Instant actions (advance/approve/select) have no MMA batch to await.
    if (!handler) return;
    return new Promise<void>((resolve, reject) => {
      pendingRef.current.set(handler, { resolve, reject });
    });
  }, [projectId, markBusy, clearBusy]);

  const waitFor = useCallback((handler: string): Promise<void> => {
    markBusy(handler);
    return new Promise<void>((resolve, reject) => {
      pendingRef.current.set(handler, { resolve, reject });
    });
  }, [markBusy]);

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
