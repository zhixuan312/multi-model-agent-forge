// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { errName, responseError } from '@/lib/err';

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

/**
 * Every failing fetch in the app hand-wrote the same three lines — ten times across five
 * files. The `.catch(() => null)` is the part that matters and the part easiest to omit:
 * a 500 that returns an HTML error page makes `res.json()` THROW, and a handler without
 * it reports nothing at all.
 */
describe('responseError', () => {
  const res = (body: unknown): Response => ({ json: async () => body } as unknown as Response);

  it('prefers the server error message', async () => {
    expect(await responseError(res({ error: 'Username taken.' }), 'fallback')).toBe('Username taken.');
  });

  it('falls back when the body carries no error field', async () => {
    expect(await responseError(res({}), 'Could not add the member.')).toBe('Could not add the member.');
    expect(await responseError(res(null), 'fallback')).toBe('fallback');
  });

  it('falls back rather than throwing when the body is not JSON at all', async () => {
    const html = { json: async () => { throw new SyntaxError('Unexpected token <'); } } as unknown as Response;
    await expect(responseError(html, 'Could not save.')).resolves.toBe('Could not save.');
  });
});
