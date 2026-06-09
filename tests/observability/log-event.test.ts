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
