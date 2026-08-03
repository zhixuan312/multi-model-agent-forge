// @vitest-environment node
/**
 * `logEvent` forwards whatever the caller sets, dropping only `undefined`.
 *
 * That matters because the alternative was tried and failed twice. `poll-log.ts` — a second
 * structured logger with the same record shape, the same swappable console sink and the same
 * `set*Sink` restore contract — emitted by NAMING each optional field:
 *
 *     ...(record.batchId !== undefined ? { batchId: record.batchId } : {}),
 *
 * So a field added to its record type typechecked cleanly and was silently dropped at emit.
 * `log-event.ts` had the same bug, fixed it, and wrote the reason down — "a whitelist that has
 * to be remembered is a whitelist that eventually is not" — while its twin kept it. The two
 * are now one module; this pins the property that made the merge safe.
 */
import { setLogSink, logEvent, type LogRecord } from '@/observability/log-event';

function capture(fn: () => void): LogRecord[] {
  const seen: LogRecord[] = [];
  const restore = setLogSink((r) => seen.push(r));
  try { fn(); } finally { restore(); }
  return seen;
}

describe('logEvent', () => {
  it('forwards every declared field — including the ones the second logger dropped', () => {
    const [rec] = capture(() =>
      logEvent({ event: 'poll.retry', projectId: 'p1', batchId: 'b1', taskId: 't1', attempt: 2, backoffMs: 500 }),
    );
    expect(rec).toMatchObject({
      event: 'poll.retry', projectId: 'p1', batchId: 'b1', taskId: 't1', attempt: 2, backoffMs: 500,
    });
  });

  it('stamps ts and level, and leaves an explicit level alone', () => {
    const [auto] = capture(() => logEvent({ event: 'task.done' }));
    expect(auto.level).toBe('info');
    expect(() => new Date(auto.ts).toISOString()).not.toThrow();

    const [explicit] = capture(() => logEvent({ event: 'task.failed', level: 'error' }));
    expect(explicit.level).toBe('error');
  });

  it('omits absent fields rather than emitting empty keys', () => {
    const [rec] = capture(() => logEvent({ event: 'session.logout', actorId: 'm1' }));
    expect(Object.keys(rec).sort()).toEqual(['actorId', 'event', 'level', 'ts']);
  });

  it('restores the previous sink, so one test cannot silence the next', () => {
    const outer: LogRecord[] = [];
    const restoreOuter = setLogSink((r) => outer.push(r));
    capture(() => logEvent({ event: 'task.done' }));   // inner sink, restored on exit
    logEvent({ event: 'task.cancelled' });
    restoreOuter();
    expect(outer.map((r) => r.event)).toEqual(['task.cancelled']);
  });
});
