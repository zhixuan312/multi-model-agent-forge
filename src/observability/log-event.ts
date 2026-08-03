/**
 * Operational structured logging (Spec 1 NFR F5/F8/F20) — distinct from the
 * domain `action_log` (Spec 3). Emits one JSON record per security-relevant
 * auth/admin/startup event through a single `logEvent` helper.
 *
 * The password is NEVER part of this record shape and must never be logged.
 */

export type LogEventName =
  | 'login.success'
  | 'login.failure'
  | 'login.throttled'
  | 'login.insecure_cookie'
  | 'session.logout'
  | 'session.revoke'
  | 'member.create'
  | 'member.toggle_admin'
  | 'member.reset_password'
  | 'member.delete'
  // Boot + background-worker events. These were emitted as raw
  // `console.log(JSON.stringify({ event: 'snake_case', … }))` — a second structured-log
  // shape with no `ts`, no `level` and no swappable sink, in a module whose own doc says
  // records go out "through a single `logEvent` helper".
  | 'startup.fatal'
  | 'startup.export_deferred'
  | 'startup.poll_manager_rehydrated'
  | 'startup.poll_manager_deferred'
  | 'startup.synthesis_reconciled'
  | 'startup.synthesis_deferred'
  | 'startup.loop_scheduler_started'
  | 'startup.loop_scheduler_deferred'
  | 'startup.automation_resumed'
  | 'startup.automation_resume_failed'
  | 'startup.automation_deferred'
  | 'loop.plan_turn_failed'
  | 'loop.journal_turn_failed';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogRecord {
  ts: string;
  level: LogLevel;
  event: LogEventName;
  actorId?: string;
  targetId?: string;
  rateLimitKey?: string;
  ip?: string;
  /** Operator-facing explanation for events that need one (e.g. a config hint). */
  detail?: string;
  /** The project a boot-resumed automation belongs to. */
  projectId?: string;
  /** How many items a boot sweep handled. */
  count?: number;
  /** The repo a loop turn was working in. */
  repo?: string;
}

export type LogSink = (record: LogRecord) => void;

/** Default sink — the platform logger (console). Swappable for tests. */
let sink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === 'error') {
    console.error(line);
  } else if (record.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
};

/** Override the log sink (tests capture records this way). Returns a restore fn. */
export function setLogSink(next: LogSink): () => void {
  const prev = sink;
  sink = next;
  return () => {
    sink = prev;
  };
}

/** Emit one operational log record. `ts`/`level` defaults applied if omitted. */
export function logEvent(
  record: Omit<LogRecord, 'ts' | 'level'> & { ts?: string; level?: LogLevel },
): void {
  // Forward whatever the caller set, dropping only `undefined` so a record stays free of
  // empty keys. This used to name each optional field, which meant adding one to
  // `LogRecord` typechecked cleanly and then silently discarded it at emit — a whitelist
  // that has to be remembered is a whitelist that eventually is not.
  const { ts, level, ...rest } = record;
  sink({
    ts: ts ?? new Date().toISOString(),
    level: level ?? 'info',
    ...(Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Omit<LogRecord, 'ts' | 'level'>),
  });
}
