// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { errName } from '@/lib/err';

/**
 * `errName` was three character-for-character copies (exploration/dispatch,
 * sse/poll-manager, transcribe/openai) and none of them had a test. It labels telemetry
 * and drives abort handling, so the duck-typing is the point: the values it sees are
 * frequently NOT real `Error` instances.
 */
describe('errName', () => {
  it('reads the name off a real Error and its subclasses', () => {
    expect(errName(new Error('x'))).toBe('Error');
    expect(errName(new TypeError('x'))).toBe('TypeError');
  });

  it('reads the name off a NON-Error that merely carries one', () => {
    // The case `instanceof Error` would miss: a DOMException crossing a realm boundary,
    // or a plain object from a fetch polyfill. This is why it is duck-typed.
    expect(errName({ name: 'AbortError' })).toBe('AbortError');
    expect(errName({ name: 'AbortError', message: 'aborted' })).toBe('AbortError');
  });

  it('falls back to "Error" for a value with no usable name', () => {
    for (const v of [null, undefined, 'a string', 42, {}, [], { name: 123 }, { name: null }]) {
      expect(errName(v)).toBe('Error');
    }
  });

  it('never throws, whatever it is handed', () => {
    // It runs inside catch blocks; throwing here would replace the original failure.
    expect(() => errName(Object.create(null))).not.toThrow();
    expect(() => errName(Symbol('s'))).not.toThrow();
  });
});
