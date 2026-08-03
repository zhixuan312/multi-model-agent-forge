// @vitest-environment node
import { logEvent, setLogSink, type LogRecord } from '@/observability/log-event';

describe('logEvent (operational structured logging)', () => {
  it('emits a record of the pinned shape with defaults applied', () => {
    const captured: LogRecord[] = [];
    const restore = setLogSink((r) => captured.push(r));
    try {
      logEvent({ event: 'login.failure', level: 'warn', rateLimitKey: 'u:alice', ip: '1.2.3.4' });
    } finally {
      restore();
    }
    expect(captured).toHaveLength(1);
    const rec = captured[0];
    expect(rec.event).toBe('login.failure');
    expect(rec.level).toBe('warn');
    expect(rec.rateLimitKey).toBe('u:alice');
    expect(rec.ip).toBe('1.2.3.4');
    expect(typeof rec.ts).toBe('string');
  });

  it('a login.failure record never contains the plaintext password', () => {
    const captured: LogRecord[] = [];
    const restore = setLogSink((r) => captured.push(r));
    try {
      logEvent({ event: 'login.failure', level: 'warn', rateLimitKey: 'u:bob', ip: '9.9.9.9' });
    } finally {
      restore();
    }
    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain('password');
    expect(Object.keys(captured[0])).not.toContain('password');
  });

  it('a member.create record carries actorId + targetId', () => {
    const captured: LogRecord[] = [];
    const restore = setLogSink((r) => captured.push(r));
    try {
      logEvent({ event: 'member.create', actorId: 'admin-1', targetId: 'new-2' });
    } finally {
      restore();
    }
    expect(captured[0].actorId).toBe('admin-1');
    expect(captured[0].targetId).toBe('new-2');
    expect(captured[0].level).toBe('info'); // default level
  });

  it('a startup.fatal record is level error', () => {
    const captured: LogRecord[] = [];
    const restore = setLogSink((r) => captured.push(r));
    try {
      logEvent({ event: 'startup.fatal', level: 'error' });
    } finally {
      restore();
    }
    expect(captured[0].event).toBe('startup.fatal');
    expect(captured[0].level).toBe('error');
  });
});
/**
 * Boot and background-worker events were emitted as raw
 * `console.log(JSON.stringify({ event: 'snake_case', … }))` — a second structured-log
 * shape with no `ts`, no `level` and no swappable sink, in a module whose own doc says
 * records go out "through a single `logEvent` helper". None of it was observable from a
 * test, which is the practical cost.
 */
describe('operational events go through the one helper', () => {
  it('gives a boot event the same record shape as an auth event', () => {
    const seen: LogRecord[] = [];
    const restore = setLogSink((r) => seen.push(r));
    try {
      logEvent({ event: 'startup.loop_scheduler_started' });
      logEvent({ event: 'startup.automation_resumed', projectId: 'p1', detail: 'Payments' });
    } finally {
      restore();
    }
    expect(seen).toHaveLength(2);
    for (const r of seen) {
      expect(r.ts).toEqual(expect.any(String));
      expect(r.level).toBe('info');
    }
    expect(seen[1]).toMatchObject({ projectId: 'p1', detail: 'Payments' });
  });

  it('carries a deferred step as a warning, with the reason', () => {
    const seen: LogRecord[] = [];
    const restore = setLogSink((r) => seen.push(r));
    try {
      logEvent({ event: 'startup.poll_manager_deferred', level: 'warn', detail: 'db unavailable' });
    } finally {
      restore();
    }
    expect(seen[0]).toMatchObject({ level: 'warn', detail: 'db unavailable' });
  });

  /**
   * The emitter used to name each optional field it forwarded, so adding one to
   * `LogRecord` typechecked cleanly and was then silently dropped at emit. Caught by the
   * boot-event case above when `projectId` never arrived.
   */
  it('forwards any field the record carries, not a remembered list', () => {
    const seen: LogRecord[] = [];
    const restore = setLogSink((r) => seen.push(r));
    try {
      logEvent({ event: 'startup.synthesis_reconciled', count: 3, repo: 'forge', projectId: 'p9' });
    } finally {
      restore();
    }
    expect(seen[0]).toMatchObject({ count: 3, repo: 'forge', projectId: 'p9' });
  });

  it('still drops undefined so a record has no empty keys', () => {
    const seen: LogRecord[] = [];
    const restore = setLogSink((r) => seen.push(r));
    try {
      logEvent({ event: 'startup.loop_scheduler_started', detail: undefined });
    } finally {
      restore();
    }
    expect(Object.keys(seen[0]!).sort()).toEqual(['event', 'level', 'ts']);
  });
});
