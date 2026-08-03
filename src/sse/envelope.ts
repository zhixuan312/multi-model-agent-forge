import type { ProjectEvent } from '@/sse/event-bus';
import { POLL_HARD_TIMEOUT_MS } from '@/sse/poll-manager';

/**
 * Terminal-envelope interpretation (Spec 5). The MMA terminal envelope's `error`
 * field is an `errorSchema` object (`{code,message,...}`) on failure, and
 * `{kind:'not_applicable'}` on success. The context-block id (when present) is a
 * SINGLE top-level `envelope.contextBlockId` — never per-`results[i]`. (The citation
 * here named the engine's `lifecycle/task-executor.ts`, a layer since deleted; the shape
 * is the one `MmaTerminalEnvelope` in `mma/client.ts` declares.)
 *
 * Engine 5.16 added two terminal states beyond `completed`/`done_with_concerns`/
 * `failed`, BOTH of which carry a non-null `error` — so "has an error" is no longer
 * a sufficient failure test:
 *   - `cancelled`   — a caller asked for cancellation (`error.code === 'aborted'`).
 *     This is DELIBERATE, not a fault: it must never look like a failure, or Forge's
 *     automation would auto-retry work a human just stopped.
 *   - `interrupted` — the daemon restarted mid-task (`error.code === 'daemon_restarted'`,
 *     `retryable: true`). Resubmitting IS the correct response, so it maps to `failed`
 *     — but its distinct code/message is preserved so the UI says "the engine
 *     restarted", not a generic pipeline failure.
 * `done_with_concerns` stays a SUCCESS (concerns are advisory).
 */

export interface TerminalState {
  status: 'done' | 'failed' | 'cancelled';
  error: { code: string; message: string } | null;
  contextBlockId: string | null;
}

function isNotApplicable(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { kind?: unknown }).kind === 'not_applicable'
  );
}

/**
 * Interpret a terminal envelope (v5.4+): success vs failure vs cancellation +
 * extract error/cbId.
 * Shape: { task: { status }, output: { contextBlockId }, error: { code, message } | null }
 */
export function interpretTerminal(envelope: unknown): TerminalState {
  const env = (envelope ?? {}) as Record<string, unknown>;

  const err = env.error;
  let error: { code: string; message: string } | null = null;
  if (err && !isNotApplicable(err)) {
    const e = err as { code?: unknown; message?: unknown };
    error = {
      code: typeof e.code === 'string' ? e.code : 'mma_error',
      message: typeof e.message === 'string' ? e.message : 'The task failed.',
    };
  }

  const task = env.task as { status?: string } | undefined;
  if (!error && task?.status === 'failed') {
    error = { code: 'pipeline_failed', message: 'Pipeline completed with failed status' };
  }

  const output = env.output as { contextBlockId?: unknown } | undefined;
  const cb = output?.contextBlockId;

  // `task.status` is authoritative for cancellation: a cancelled task carries
  // `error.code === 'aborted'`, which the error-presence test below would otherwise
  // read as a failure. Keep the error for the UI message/context.
  if (task?.status === 'cancelled') {
    return {
      status: 'cancelled',
      error: error ?? { code: 'aborted', message: 'Execution cancelled by caller' },
      contextBlockId: typeof cb === 'string' ? cb : null,
    };
  }

  return {
    status: error ? 'failed' : 'done',
    error,
    contextBlockId: typeof cb === 'string' ? cb : null,
  };
}

/**
 * The synthesized timeout error used by the hard-timeout transition.
 *
 * The duration is DERIVED from `POLL_HARD_TIMEOUT_MS`. It read "within 15m" while the
 * real ceiling had moved to an hour, so the message a user saw named a wait that never
 * happened — and a second hardcoded duration is exactly how that drift starts.
 */
export const FORGE_POLL_TIMEOUT_ERROR = {
  code: 'forge_poll_timeout',
  message: `no terminal envelope within ${Math.round(POLL_HARD_TIMEOUT_MS / 60_000)}m`,
} as const;

/** Build the SSE event for a terminal batch (done vs failed vs cancelled). */
export function terminalEvent(args: {
  taskId: string;
  mmaBatchId: string;
  route: string;
  state: TerminalState;
}): ProjectEvent {
  if (args.state.status === 'cancelled') {
    return {
      type: 'task.cancelled',
      taskId: args.taskId,
      mmaBatchId: args.mmaBatchId,
      route: args.route,
      error: args.state.error ?? { code: 'aborted', message: 'Execution cancelled by caller' },
    };
  }
  if (args.state.status === 'failed') {
    return {
      type: 'task.failed',
      taskId: args.taskId,
      mmaBatchId: args.mmaBatchId,
      route: args.route,
      error: args.state.error ?? { code: 'mma_error', message: 'The task failed.' },
    };
  }
  return {
    type: 'task.done',
    taskId: args.taskId,
    mmaBatchId: args.mmaBatchId,
    route: args.route,
    status: 'recorded',
  };
}
