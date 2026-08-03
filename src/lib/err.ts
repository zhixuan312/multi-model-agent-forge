/**
 * Narrowing helpers for values caught in a `catch`, where the type is `unknown` and
 * the value is not guaranteed to be an `Error` at all.
 *
 * `errName` existed as three character-for-character copies — in `exploration/dispatch`,
 * `sse/poll-manager` and `transcribe/openai`. It is the kind of six-line helper that
 * feels too small to share right up until the moment one copy is fixed and the others
 * are not.
 */

/**
 * The `name` of a caught value, or `'Error'` when it has none.
 *
 * Deliberately duck-typed rather than `instanceof Error`: the callers use this to label
 * telemetry and abort handling, where the value is frequently NOT a real `Error` — a
 * DOMException `AbortError` crossing a realm boundary, or a plain `{ name }` object from
 * a fetch polyfill, both fail `instanceof` while carrying the name that matters.
 */
export function errName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return 'Error';
}

/**
 * The human-readable reason a request failed, or `fallback` when the body is missing,
 * unparseable, or carries neither field.
 *
 * Every failing `fetch` in the app hand-wrote the same three lines —
 * `const b = (await res.json().catch(() => null)) as { error?: string } | null;` then
 * `b?.error ?? '…'`. The `.catch(() => null)` is the part that matters and the part
 * easiest to leave out: a 500 that returns an HTML error page makes `res.json()` THROW,
 * and a handler without it reports nothing at all.
 *
 * `message` is read FIRST because the API has two error envelopes, and only one of them
 * puts prose in `error`:
 *   - most routes: `{ error: 'Repo not found.' }`      → `error` IS the sentence
 *   - configure-provider, connections/validate, loops: `{ error: 'forbidden', message: … }`
 *                                                       → `error` is a machine CODE
 * Reading `error` alone showed users the code ("forbidden", "not_found"). Reading
 * `message` first is correct for both shapes, since the routes that put prose in `error`
 * have no `message` at all.
 */
export async function responseError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  return body?.message ?? body?.error ?? fallback;
}
