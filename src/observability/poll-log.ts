/**
 * Structured server-side logging for the PollManager + the exploration
 * orchestration calls (Spec 5 §observability — "not client-toast-only"). A
 * batch stuck in `running`, a silent poll-loop stall, and a propose/
 * synthesize/transcribe failure must each be diagnosable from logs alone.
 * Distinct from the domain `action_log`.
 */

export type PollLogEvent =
  | 'dispatch.failure'
  | 'poll.retry'
  | 'poll.timeout'
  | 'poll.not_found'
  | 'task.done'
  | 'task.failed'
  | 'rehydrate'
  | 'mma.call_error'
  | 'openai.call_error'
  | 'propose.failure'
  | 'synthesize.failure'
  | 'auto_draft.failure'
  | 'handler.failed';

export interface PollLogRecord {
  ts: string;
  level: 'info' | 'warn' | 'error';
  event: PollLogEvent;
  projectId?: string;
  batchId?: string;
  taskId?: string;
  /** poll.retry carries the attempt index + the computed backoff (ms). */
  attempt?: number;
  backoffMs?: number;
  detail?: string;
}

export type PollLogSink = (record: PollLogRecord) => void;

let sink: PollLogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (record.level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
};

/** Override the sink (tests spy on emitted records). Returns a restore fn. */
export function setPollLogSink(next: PollLogSink): () => void {
  const prev = sink;
  sink = next;
  return () => {
    sink = prev;
  };
}

export function logPoll(
  record: Omit<PollLogRecord, 'ts' | 'level'> & { ts?: string; level?: PollLogRecord['level'] },
): void {
  sink({
    ts: record.ts ?? new Date().toISOString(),
    level: record.level ?? 'info',
    event: record.event,
    ...(record.projectId !== undefined ? { projectId: record.projectId } : {}),
    ...(record.batchId !== undefined ? { batchId: record.batchId } : {}),
    ...(record.taskId !== undefined ? { taskId: record.taskId } : {}),
    ...(record.attempt !== undefined ? { attempt: record.attempt } : {}),
    ...(record.backoffMs !== undefined ? { backoffMs: record.backoffMs } : {}),
    ...(record.detail !== undefined ? { detail: record.detail } : {}),
  });
}
