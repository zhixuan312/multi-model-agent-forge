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
  | 'session.logout'
  | 'session.revoke'
  | 'member.create'
  | 'member.toggle_admin'
  | 'member.reset_password'
  | 'member.delete'
  | 'startup.fatal';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogRecord {
  ts: string;
  level: LogLevel;
  event: LogEventName;
  actorId?: string;
  targetId?: string;
  rateLimitKey?: string;
  ip?: string;
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
  sink({
    ts: record.ts ?? new Date().toISOString(),
    level: record.level ?? 'info',
    event: record.event,
    ...(record.actorId !== undefined ? { actorId: record.actorId } : {}),
    ...(record.targetId !== undefined ? { targetId: record.targetId } : {}),
    ...(record.rateLimitKey !== undefined ? { rateLimitKey: record.rateLimitKey } : {}),
    ...(record.ip !== undefined ? { ip: record.ip } : {}),
  });
}
