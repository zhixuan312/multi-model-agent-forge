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

  it('strips the words token / secret / password / api_key / bearer (case-insensitive)', () => {
    for (const bad of ['token=abc', 'my SECRET here', 'password: hunter2', 'api_key xyz', 'Bearer zzz']) {
      expect(redactMessage(bad)).toContain('«redacted»');
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
