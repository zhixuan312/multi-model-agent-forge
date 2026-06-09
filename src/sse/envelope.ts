import type { ProjectEvent } from '@/sse/event-bus';

/**
 * Terminal-envelope interpretation (Spec 5). The MMA terminal envelope's `error`
 * field is an `errorSchema` object (`{code,message,...}`) on failure, and
 * `{kind:'not_applicable'}` on success. The context-block id (when present) is a
 * SINGLE top-level `envelope.contextBlockId` — never per-`results[i]` (verified
 * against MMA `lifecycle/task-executor.ts`).
 */

export interface TerminalState {
  status: 'done' | 'failed';
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

/** Interpret a terminal envelope: success vs failure + extract the error/cbId. */
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
  const cb = env.contextBlockId;
  return {
    status: error ? 'failed' : 'done',
    error,
    contextBlockId: typeof cb === 'string' ? cb : null,
  };
}

/** The synthesized timeout error used by the hard-timeout transition. */
export const FORGE_POLL_TIMEOUT_ERROR = {
  code: 'forge_poll_timeout',
  message: 'no terminal envelope within 15m',
} as const;

/** Build the SSE event for a terminal batch (done vs failed). */
export function terminalEvent(args: {
  taskId: string;
  mmaBatchId: string;
  route: string;
  state: TerminalState;
}): ProjectEvent {
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
