'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useMmaDispatch — unified hook for all MMA dispatch calls.
 *
 * Handles the full lifecycle:
 * 1. POST dispatch (returns 202)
 * 2. SSE listener for completion/failure events
 * 3. Busy state per handler
 * 4. Error state with retry
 * 5. Success callback to update the right cache
 */

export interface MmaDispatchHandler {
  onDone: () => void | Promise<void>;
  onFailed?: (error: string) => void;
}

export interface UseMmaDispatchOpts {
  handlers: Record<string, MmaDispatchHandler>;
  events?: Record<string, (data: Record<string, unknown>) => void | Promise<void>>;
}

export interface MmaDispatchState {
  busy: boolean;
  busyHandlers: Set<string>;
  error: string | null;
  dispatch: (url: string, handler: string, body?: unknown) => Promise<void>;
  clearError: () => void;
  retry: () => Promise<void>;
}

export function useMmaDispatch(projectId: string, opts: UseMmaDispatchOpts): MmaDispatchState {
  const [busyHandlers, setBusyHandlers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const lastDispatch = useRef<{ url: string; handler: string; body?: unknown } | null>(null);

  // Refs so the SSE listener always has the latest handlers without re-subscribing
  const handlersRef = useRef(opts.handlers);
  handlersRef.current = opts.handlers;
  const eventsRef = useRef(opts.events);
  eventsRef.current = opts.events;

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

  useEffect(() => {
    if (!projectId || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/projects/${projectId}/events`);

    es.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        const type = data.type as string;

        if (type === 'dispatch.done') {
          const handler = data.handler as string;
          const h = handlersRef.current[handler];
          if (h) {
            void Promise.resolve(h.onDone()).finally(() => clearBusy(handler));
          }
        }

        if (type === 'dispatch.failed') {
          const handler = data.handler as string;
          const errorMsg = (data.error as string) ?? 'The operation failed.';
          clearBusy(handler);
          const h = handlersRef.current[handler];
          if (h?.onFailed) {
            h.onFailed(errorMsg);
          } else {
            setError(errorMsg);
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
    lastDispatch.current = { url, handler, body };

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
      setError(e instanceof Error ? e.message : 'Dispatch failed.');
    }
  }, [markBusy, clearBusy]);

  const retry = useCallback(async () => {
    if (!lastDispatch.current) return;
    const { url, handler, body } = lastDispatch.current;
    await dispatch(url, handler, body);
  }, [dispatch]);

  const clearError = useCallback(() => setError(null), []);

  return {
    busy: busyHandlers.size > 0,
    busyHandlers,
    error,
    dispatch,
    clearError,
    retry,
  };
}
