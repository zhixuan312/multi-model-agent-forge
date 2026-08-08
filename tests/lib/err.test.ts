// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { errName, errMessage, responseError } from '@/lib/err';

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

  /**
   * The API has two error envelopes. Most routes put the sentence in `error`; four
   * (configure-provider, connections/validate, loops ×2) put a machine CODE there and the
   * sentence in `message`. Reading `error` alone showed users "forbidden" and "not_found".
   */
  it('reads message first, so a machine code in `error` never reaches the user', async () => {
    expect(await responseError(res({ error: 'forbidden', message: 'Only an org admin can configure providers.' }), 'fallback'))
      .toBe('Only an org admin can configure providers.');
  });

  it('still uses `error` for the routes that put the sentence there', async () => {
    expect(await responseError(res({ error: 'Repo not found.' }), 'fallback')).toBe('Repo not found.');
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

/** `e instanceof Error ? e.message : String(e)` was written out seven times. */
describe('errMessage', () => {
  it('reads the message off a real Error', () => {
    expect(errMessage(new TypeError('bad input'))).toBe('bad input');
  });

  it('stringifies anything else rather than yielding undefined', () => {
    expect(errMessage('boom')).toBe('boom');
    expect(errMessage(42)).toBe('42');
    expect(errMessage(null)).toBe('null');
    expect(errMessage({ message: 'not an Error' })).toBe('[object Object]');
  });
});

/**
 * The `cause` chain is where the reason actually is.
 *
 * These are the two shapes this app fails with most, and reading `.message` alone throws
 * away the only useful token in both:
 *
 *   Drizzle  message "Failed query: select … from forge.loop_def"   cause ECONNREFUSED
 *   fetch    message "fetch failed"                                 cause ENOTFOUND
 *
 * The loops scheduler printed `[loops] scheduler tick failed: Failed query: select "id",
 * "team_id", … where "enabled" = $1 / params: true` once a minute. It named the statement,
 * every column and the bound parameter — and not the reason. The table was fine; the
 * database was briefly unreachable, and nothing in the log could say so.
 */
describe('errMessage surfaces the cause chain', () => {
  it('appends the cause, so a wrapped failure names its reason', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    const wrapped = new Error('Failed query: select "id" from "forge"."loop_def"', { cause });
    const out = errMessage(wrapped);
    expect(out).toContain('Failed query');
    expect(out, 'the reason must survive').toContain('ECONNREFUSED');
  });

  it('prefixes a code the message does not already carry', () => {
    // `42P01` appears nowhere in "relation ... does not exist", so without this the
    // Postgres error class is lost even though the sentence survives.
    const cause = Object.assign(new Error('relation "forge.loop_def" does not exist'), { code: '42P01' });
    expect(errMessage(new Error('Failed query: select 1', { cause }))).toContain('42P01');
  });

  it('does not repeat a code the message already spells out', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:5432'), { code: 'ECONNREFUSED' });
    const out = errMessage(new Error('fetch failed', { cause }));
    expect(out.match(/ECONNREFUSED/g), 'the code should read once, not twice').toHaveLength(1);
  });

  it('walks more than one level — undici nests fetch failures', () => {
    const root = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
    const mid = new Error('fetch failed', { cause: root });
    expect(errMessage(new Error('MMA dispatch failed', { cause: mid }))).toContain('certificate has expired');
  });

  it('terminates on a self-referential cause rather than hanging', () => {
    // `cause` is caller-supplied; nothing stops it pointing at itself.
    const e = new Error('loop') as Error & { cause?: unknown };
    e.cause = e;
    expect(() => errMessage(e)).not.toThrow();
    expect(errMessage(e)).toBe('loop');
  });

  it('is unchanged for an error with no cause', () => {
    expect(errMessage(new TypeError('bad input'))).toBe('bad input');
  });
});
