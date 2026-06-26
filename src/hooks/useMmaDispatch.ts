'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * useMmaDispatch — unified hook for all MMA dispatch calls.
 *
 * Handles the full lifecycle:
 * 1. POST dispatch (returns 202)
 * 2. SSE listener for completion/failure events
 * 3. Busy state per handler
 * 4. Error state with retry
 * 5. Success callback to update the right cache
 *
 * Every stage client uses this instead of inline SSE listeners + setBusy + setError.
 */

export interface MmaDispatchHandler {
  /** Called when the dispatch completes successfully. Update cache here. */
  onDone: () => void | Promise<void>;
  /** Optional: called on failure. Default shows the error message. */
  onFailed?: (error: string) => void;
}

export interface UseMmaDispatchOpts {
  /** Map of handler names to callbacks. */
  handlers: Record<string, MmaDispatchHandler>;
  /** Also react to typed events (e.g. synthesis.updated, task.done). */
  events?: Record<string, (data: Record<string, unknown>) => void | Promise<void>>;
}

export interface MmaDispatchState {
  /** True when any dispatch is in flight. */
  busy: boolean;
  /** Per-handler busy state. */
  busyHandlers: Set<string>;
  /** Last error message, or null. */
  error: string | null;
  /** Dispatch an action — POST to the URL, track busy/error via SSE. */
  dispatch: (url: string, handler: string, body?: unknown) => Promise<void>;
  /** Clear the error (e.g. on dismiss). */
  clearError: () => void;
  /** Retry the last failed dispatch. */
  retry: () => Promise<void>;
}

export function useMmaDispatch(projectId: string, opts: UseMmaDispatchOpts): MmaDispatchState {
  const [busyHandlers, setBusyHandlers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const lastDispatch = useRef<{ url: string; handler: string; body?: unknown } | null>(null);
  const qc = useQueryClient();

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

  // SSE listener — one connection per project, handles all dispatch events
  useEffect(() => {
    if (!projectId || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/projects/${projectId}/events`);

    es.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        const type = data.type as string;

        // dispatch.done — handler completed successfully
        if (type === 'dispatch.done') {
          const handler = data.handler as string;
          if (opts.handlers[handler]) {
            void Promise.resolve(opts.handlers[handler].onDone()).finally(() => clearBusy(handler));
          }
        }

        // dispatch.failed — handler or MMA failed
        if (type === 'dispatch.failed') {
          const handler = data.handler as string;
          const errorMsg = (data.error as string) ?? 'The operation failed.';
          clearBusy(handler);
          if (opts.handlers[handler]?.onFailed) {
            opts.handlers[handler].onFailed!(errorMsg);
          } else {
            setError(errorMsg);
          }
        }

        // Typed events (synthesis.updated, task.done, etc.)
        if (opts.events?.[type]) {
          void Promise.resolve(opts.events[type](data));
        }
      } catch { /* ignore malformed SSE frames */ }
    };

    return () => es.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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
      // 202 accepted — SSE will notify when done
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
