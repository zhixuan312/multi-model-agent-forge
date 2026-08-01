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
