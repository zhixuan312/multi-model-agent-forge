'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useMmaDispatch — centralised hook for ALL MMA dispatch calls.
 *
 * Self-recovering: on mount, fetches pending handlers from the server so the
 * UI knows about in-flight batches even after a page refresh. The SSE
 * connection then picks up dispatch.done/dispatch.failed when the PollManager
 * resolves them.
 */

export interface UseMmaDispatchOpts {
  /** Handler names already in-flight (server-side, avoids the fetch). */
  initialBusy?: string[];
  events?: Record<string, (data: Record<string, unknown>) => void | Promise<void>>;
}

export interface MmaDispatchState {
  busy: boolean;
  busyHandlers: Set<string>;
  error: string | null;
  dispatch: (url: string, handler: string, body?: unknown) => Promise<void>;
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

  const pendingRef = useRef<Map<string, PendingDispatch>>(new Map());

  const markBusy = useCallback((handler: string) => {
    setBusyHandlers((prev) => new Set(prev).add(handler));
  }, []);

  const clearBusy = useCallback((handler: string) => {
    setBusyHandlers((prev) => {
      const next = new Set(prev);
      next.delete(handler);
      return next;
    });
  }, []);

  // On mount: fetch pending handlers from the server so the UI shows busy
  // state for in-flight batches dispatched before this page load.
  // The endpoint probes MMA and auto-fails 404 batches before responding.
  useEffect(() => {
    if (!projectId || opts?.initialBusy) return;
    fetch(`/api/projects/${projectId}/pending-handlers`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { handlers: string[] } | null) => {
        if (data) {
          setBusyHandlers(new Set(data.handlers));
        }
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
          const pending = pendingRef.current.get(handler);
          if (pending) {
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
    error,
    dispatch,
    waitFor,
    clearError,
  };
}
