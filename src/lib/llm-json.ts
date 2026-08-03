/**
 * Extracting the JSON a model meant to send, out of the reply it actually sent.
 *
 * Every consumer of an MMA envelope had its own unwrapper — five distinct regexes across
 * eight files — and they disagreed about what a model is allowed to emit:
 *
 *   - Some stripped only a ```json fence; a bare ``` fence was left in place, so
 *     `JSON.parse` threw.
 *   - Some anchored the fence to the whole string; a reply with a sentence before the
 *     block ("Here's the report:") parsed nowhere.
 *   - Some tolerated trailing whitespace after the closing fence; others did not.
 *
 * The paths that mattered most were the least tolerant. `audit-loop` and `review-findings`
 * gate the SDLC, and both treated a parse failure exactly like a clean result: no findings
 * extracted, verdict `clean`, stage advances. A model emitting a bare fence could turn a
 * failing audit into a passing one, silently. That is the bug this module exists to remove.
 *
 * The rule, applied once, is the union of what those eight sites individually accepted:
 * take the first fenced block if there is one (any language tag, or none), otherwise the
 * whole reply; then take the first complete JSON value inside it, ignoring prose on either
 * side.
 */

/** The opening/closing pair for the two JSON container types we accept at top level. */
const CLOSER: Record<string, string> = { '{': '}', '[': ']' };

/**
 * Scan from `open` to the index just past its matching close, respecting strings and
 * escapes so a brace inside a string value cannot end the object early. Returns -1 when
 * the value never closes (a truncated reply).
 */
function balancedEnd(text: string, open: number): number {
  const closer = CLOSER[text[open]!]!;
  const opener = text[open]!;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === opener) depth++;
    else if (c === closer) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** How many container starts to try in one body before giving up. Prose rarely has more. */
const MAX_STARTS = 20;

/**
 * Every complete JSON value in `body`, in order, starting from each `{` or `[`.
 *
 * This yielded only the FIRST one, which meant a single brace in the prose ahead of the
 * payload swallowed the whole reply: `Use {name} as the key. Report: {"findings":[…]}`
 * scanned `{name}`, failed to parse it, and returned null — and this module's own header
 * records what null means on the audit paths, where an unparseable reply reads as a clean
 * one. Models write braces in prose. Trying the next start costs nothing.
 */
function* jsonValues(body: string): Generator<string> {
  let from = 0;
  for (let tried = 0; tried < MAX_STARTS; tried++) {
    const opens = ['{', '['].map((c) => body.indexOf(c, from)).filter((i) => i !== -1);
    if (opens.length === 0) return;
    const open = Math.min(...opens);

    const end = balancedEnd(body, open);
    if (end !== -1) {
      yield body.slice(open, end);
      from = open + 1;
      continue;
    }

    // Unbalanced (truncated output): fall back to the last matching closer, which is the
    // most JSON a reply like that can offer. Still likely to fail JSON.parse — that is the
    // caller's signal that the response was cut off, not that there were no findings.
    // Nothing after an unclosed container can close either, so this is the last candidate.
    const last = body.lastIndexOf(CLOSER[body[open]!]!);
    if (last > open) yield body.slice(open, last + 1);
    return;
  }
}

/** The first complete JSON value in `body`, or null if it holds no container. */
function firstJsonValue(body: string): string | null {
  for (const v of jsonValues(body)) return v;
  return null;
}

/** Does this text parse? Used to prefer a candidate that is real JSON over one that merely
 *  looks like a container. */
function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The places a JSON value might be hiding, best first: inside the fenced block, then
 * anywhere in the reply. The second candidate matters when a model opens a fence for
 * something else (a diff, a snippet) and puts the real payload outside it — without the
 * fallback that reply parses to nothing.
 */
function jsonCandidates(raw: string): string[] {
  const fence = raw.match(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/);
  return fence?.[1] ? [fence[1].trim(), raw.trim()] : [raw.trim()];
}

/**
 * The JSON text embedded in a model reply, or null when there is none.
 *
 * Tolerates a fenced block anywhere in the reply with or without a language tag, prose on
 * either side of the value, and a value that never closes (truncated output).
 */
export function extractJsonText(raw: string): string | null {
  if (!raw) return null;
  // Prefer a value that actually parses, wherever it sits…
  for (const candidate of jsonCandidates(raw)) {
    for (const value of jsonValues(candidate)) {
      if (parses(value)) return value;
    }
  }
  // …and fall back to the first container-shaped thing, so a TRUNCATED reply still comes
  // back as text the caller can fail on explicitly rather than as "there was no JSON".
  for (const candidate of jsonCandidates(raw)) {
    const found = firstJsonValue(candidate);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Parse the JSON embedded in a model reply. Returns null when there is no JSON, or when
 * what is there does not parse — callers MUST distinguish that from an empty-but-valid
 * result, because conflating the two is how an unparseable audit reads as a clean one.
 *
 * Unlike `extractJsonText`, this lets the PARSE pick the candidate: a fence whose contents
 * turn out not to be JSON does not shadow a valid object elsewhere in the reply.
 */
export function parseLlmJson<T = unknown>(raw: string | undefined | null): T | null {
  if (typeof raw !== 'string' || !raw) return null;
  for (const candidate of jsonCandidates(raw)) {
    for (const text of jsonValues(candidate)) {
      try {
        return JSON.parse(text) as T;
      } catch {
        // Try the next place the payload might be.
      }
    }
  }
  return null;
}
