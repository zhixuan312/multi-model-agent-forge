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

/**
 * The message of a caught value, or its `String()` form when it is not an Error —
 * followed by its `cause` chain, which is where the reason usually actually is.
 *
 * `e instanceof Error ? e.message : String(e)` was written out seven times — five of them
 * in the same boot file, once per deferred-startup catch.
 *
 * The `cause` half was the missing part, and it cost real diagnostic time. The two most
 * common failures in this app both wrap the reason one level down:
 *
 *   Drizzle  → message: "Failed query: select … from forge.loop_def"   cause: ECONNREFUSED
 *   fetch    → message: "fetch failed"                                 cause: ENOTFOUND / certificate expired
 *
 * Reading `.message` alone prints the SQL that failed, or the word "failed", and silently
 * drops the one token that says why. The loops scheduler logged
 * `[loops] scheduler tick failed: Failed query: select …` once a minute, which named the
 * statement, the columns and the parameter — everything except the reason.
 *
 * The chain is walked (a cause can itself have a cause) with a depth cap and a seen-set,
 * because `cause` is caller-supplied and can be self-referential.
 */
export function errMessage(err: unknown): string {
  const head = err instanceof Error ? err.message : String(err);
  const parts = [head];
  const seen = new Set<unknown>([err]);
  let cur: unknown = (err as { cause?: unknown })?.cause;
  for (let depth = 0; cur != null && depth < 4 && !seen.has(cur); depth++) {
    seen.add(cur);
    const c = cur as { code?: unknown; message?: unknown };
    const code = typeof c.code === 'string' ? c.code : null;
    const msg = cur instanceof Error ? cur.message : typeof c.message === 'string' ? c.message : String(cur);
    // The code is the useful half for a network or Postgres failure, and it is frequently
    // absent from the message text — `ECONNREFUSED` vs "connect ECONNREFUSED 127.0.0.1:5432"
    // overlap, but `42P01` does not appear in "relation ... does not exist" at all.
    const rendered = code && !msg.includes(code) ? `${code}: ${msg}` : msg;
    if (rendered && !parts.includes(rendered)) parts.push(rendered);
    cur = (cur as { cause?: unknown })?.cause;
  }
  return parts.join(' ← ');
}
