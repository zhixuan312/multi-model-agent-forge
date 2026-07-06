'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from '@/components/ui/toast';
import { redactMessage } from '@/lib/redact';

/**
 * useOptimisticAction — the ONE optimistic-update primitive (spec §4.2, OA-1..OA-9).
 *
 * It does not own state. The component owns its slice (via `useServerState`/`useState`);
 * this hook orchestrates the apply → commit → (revert | confirm) → toast sequence and
 * guarantees consistent failure messaging through the single toast channel. It owns
 * optimism + rollback + toast only — NOT per-control loading UI (that stays the
 * component's concern; see §4.1). `pending` is an aggregate in-flight count, not per-item.
 *
 *   const optimistic = useOptimisticAction();
 *   optimistic.run({
 *     apply:    () => setStatus(id, 'approved'),      // predicted state, immediately
 *     commit:   () => mma.transition('approve', { id }),
 *     rollback: () => setStatus(id, prev),            // captured snapshot
 *     error:    'Couldn’t approve — reverted.',
 *     retryable: true,                                // only if the route is idempotent
 *   });
 */

export interface OptimisticRun<T = unknown> {
  /** Apply the predicted local state immediately (synchronous, local-state only). */
  apply: () => void;
  /** Fire the server mutation. Resolves on success, rejects on failure. */
  commit: () => Promise<T>;
  /** Restore the pre-action local state. Called only if `commit` rejects. */
  rollback: () => void;
  /** Optional success toast text. Omit for silent success (the common case). */
  success?: string;
  /** Error toast text, or a function of the thrown error (sanitized via redactMessage). */
  error: string | ((err: unknown) => string);
  /** Offer Retry on the error toast. Only for verified-idempotent routes (OA-7). */
  retryable?: boolean;
  /** Runs ONLY after a successful commit (e.g. router.refresh()). Never on failure. */
  onSettled?: () => void;
  /** Failure-path reconciliation used ONLY by OA-8 when `rollback()` itself throws. */
  resync?: () => void;
}

export interface UseOptimisticAction {
  run: <T>(cfg: OptimisticRun<T>) => Promise<T | undefined>;
  /** True while at least one run() is in flight. Aggregate, not per-item. */
  pending: boolean;
}

/** Resolve the configured error into a safe, user-visible string. */
function resolveError(error: string | ((err: unknown) => string), thrown: unknown): string {
  if (typeof error === 'string') return error; // caller's fixed, trusted string
  try {
    return redactMessage(error(thrown));
  } catch {
    return redactMessage(thrown);
  }
}

export function useOptimisticAction(): UseOptimisticAction {
  const [count, setCount] = useState(0);
  const mountedRef = useRef(true);
  const runRef = useRef<UseOptimisticAction['run'] | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const run = useCallback(async function run<T>(cfg: OptimisticRun<T>): Promise<T | undefined> {
    setCount((c) => c + 1);
    try {
      // OA-1 / OA-8: apply first; if it throws, do NOT commit.
      try {
        cfg.apply();
      } catch (applyErr) {
        showToast({ type: 'error', message: resolveError(cfg.error, applyErr), retry: undefined });
        return undefined;
      }

      let value: T;
      try {
        value = await cfg.commit();
      } catch (commitErr) {
        // OA-3 / OA-8: failure path — roll back, then toast (+ optional Retry).
        let rollbackThrew = false;
        try {
          cfg.rollback();
        } catch (rbErr) {
          rollbackThrew = true;
          console.error('[useOptimisticAction] rollback() threw', rbErr);
        }
        const message = resolveError(cfg.error, commitErr);
        const retry =
          !rollbackThrew && cfg.retryable
            ? () => { if (mountedRef.current) void runRef.current?.(cfg); } // OA-7
            : undefined;
        showToast({ type: 'error', message, retry });
        if (rollbackThrew && cfg.resync) {
          try { cfg.resync(); } catch (rsErr) { console.error('[useOptimisticAction] resync() threw', rsErr); }
        }
        return undefined;
      }

      // OA-2: success — optional toast, then isolated onSettled.
      if (cfg.success) showToast({ type: 'success', message: cfg.success });
      if (cfg.onSettled) {
        try { cfg.onSettled(); } catch (osErr) { console.error('[useOptimisticAction] onSettled() threw', osErr); }
      }
      return value;
    } finally {
      setCount((c) => Math.max(0, c - 1));
    }
  }, []);

  runRef.current = run;

  return { run, pending: count > 0 };
}
