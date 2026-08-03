// @vitest-environment node
import { redactMessage } from '@/lib/redact';

// The shared toast-text redactor (spec §9 / AC-17). Toast messages that derive from a
// thrown error must never carry a stack trace, secret, token, or credential. The rule:
// take only the first line (never `err.stack`), strip control chars, and strip token-like
// substrings; fall back to a fixed generic string when the result is empty.

const CONTROL_RE = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']');

describe('redactMessage', () => {
  it('returns a short plain message unchanged', () => {
    expect(redactMessage('Could not delete the member.')).toBe('Could not delete the member.');
  });

  it('keeps only the first line — never stack frames', () => {
    const withStack = 'Request failed\n    at foo (file.ts:1:2)\n    at bar (file.ts:3:4)';
    const out = redactMessage(withStack);
    expect(out).toBe('Request failed');
    expect(out).not.toContain('\n');
    expect(out).not.toContain('at foo');
  });

  it('strips a long hex token', () => {
    const out = redactMessage('auth failed for a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
    expect(out).toContain('«redacted»');
    expect(out).not.toMatch(/a1b2c3d4e5f6/);
  });

  /**
   * The point is the VALUE, not the label. The previous version of this asserted only
   * that `«redacted»` appeared somewhere — which the old implementation satisfied by
   * replacing the word `password` and printing `hunter2` right after it.
   */
  it('redacts the value after a credential label, and keeps the label readable', () => {
    for (const [input, secret] of [
      ['token=abc123def456ghi', 'abc123def456ghi'],
      ['my SECRET here', 'here'],
      ['password: hunter2', 'hunter2'],
      ['api_key xyz789', 'xyz789'],
      ['Bearer zzz111', 'zzz111'],
    ] as const) {
      const out = redactMessage(input);
      expect(out, `${input} must not print its value`).not.toContain(secret);
      expect(out).toContain('«redacted»');
    }
    // the label survives so the message still says what failed
    expect(redactMessage('password: hunter2')).toBe('password «redacted»');
  });

  /**
   * Real credential formats. Every one of these passed through the previous
   * hex-only rule completely intact.
   */
  it('strips provider credentials that are not hex', () => {
    const cases: [string, string][] = [
      ['Incorrect API key provided: sk-proj-9aBcD3fGh1JkLmN0pQrS2tUvW4xYz', 'sk-proj-9aBcD3fGh1JkLmN0pQrS2tUvW4xYz'],
      ['bad credentials for ghp_16C7e42F292c6912E7710c838347Ae178B4a', 'ghp_16C7e42F292c6912E7710c838347Ae178B4a'],
      ['webhook rejected xoxb-EXAMPLE-0000000000-NOT-A-REAL-SLACK-TOKEN-0000', 'xoxb-EXAMPLE-0000000000-NOT-A-REAL-SLACK-TOKEN-0000'],
    ];
    for (const [input, secret] of cases) {
      expect(redactMessage(input), input).not.toContain(secret);
    }
  });

  it('strips the password out of a connection string', () => {
    const out = redactMessage('connect failed: postgres://forge:Hunter2Passw0rd@db.internal:5432/forge');
    expect(out).not.toContain('Hunter2Passw0rd');
    expect(out).toContain('postgres://«redacted»@db.internal');
  });

  it('leaves ordinary prose alone', () => {
    for (const ok of [
      'Couldn’t propose discovery tasks — try again.',
      'MMA dispatch to /task (investigate) failed with HTTP 500',
      'content-security-policy blocked the request',
    ]) {
      expect(redactMessage(ok)).toBe(ok);
    }
  });

  it('accepts an Error and reads only its message, never its stack', () => {
    const err = new Error('Boom happened');
    err.stack = 'Boom happened\n    at secretPlace (a1b2c3d4e5f6a7b8c9d0e1f2 :1:1)';
    const out = redactMessage(err);
    expect(out).toBe('Boom happened');
    expect(out).not.toContain('secretPlace');
  });

  it('strips control characters (ANSI / bell) from the message', () => {
    const bell = String.fromCharCode(7);
    const esc = String.fromCharCode(27);
    const out = redactMessage('Failed ' + bell + ' to save' + esc + '[0m');
    expect(out).not.toMatch(CONTROL_RE);
    expect(out).toContain('Failed');
    expect(out).toContain('to save');
  });

  it('falls back to a generic string for a non-error, non-string value', () => {
    expect(redactMessage(undefined)).toBe('Something went wrong.');
    expect(redactMessage({ nope: true })).toBe('Something went wrong.');
  });

  it('never returns an empty string', () => {
    expect(redactMessage('')).toBe('Something went wrong.');
    expect(redactMessage('   ')).toBe('Something went wrong.');
  });
});

/**
 * `redactMessage` took `instanceof Error`, so anything thrown from another realm — a
 * DOMException from a worker, a `{ message }` from a fetch polyfill — lost its message and
 * became the generic string. Its sibling `errName` documents why duck-typing is right for
 * caught values; this one disagreed with it.
 */
describe('a caught value that is not a same-realm Error', () => {
  it('uses the message of a plain object that carries one', () => {
    expect(redactMessage({ name: 'AbortError', message: 'The request was aborted.' }))
      .toBe('The request was aborted.');
  });

  it('still redacts inside it — nothing about the source is trusted', () => {
    expect(redactMessage({ message: 'auth failed: token=sk-proj-9aBcD3fGh1JkLmN0pQrS2tUvW4xYz' }))
      .not.toContain('sk-proj-9aBcD3fGh1JkLmN0pQrS2tUvW4xYz');
  });

  it('is still generic for a value with no message at all', () => {
    expect(redactMessage({ code: 42 })).toBe('Something went wrong.');
    expect(redactMessage(null)).toBe('Something went wrong.');
    expect(redactMessage(undefined)).toBe('Something went wrong.');
    expect(redactMessage({ message: 12 })).toBe('Something went wrong.');
  });
});
