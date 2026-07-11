/**
 * redactMessage — sanitize text destined for a user-visible toast (spec §9 / AC-17).
 *
 * A toast message that derives from a thrown error must never leak a stack trace, secret,
 * token, password, or provider credential. The rule is deliberately simple and testable:
 *
 *   1. Resolve the input to a single string — for an `Error`, use `.message` only, NEVER
 *      `.stack`; for a string, use it; for anything else, a fixed generic fallback.
 *   2. Keep only the first line (drops multi-line stack frames that some libraries pack
 *      into `.message`).
 *   3. Replace token-like substrings with «redacted».
 *   4. Never return empty — fall back to a generic message.
 *
 * Prefer passing a fixed product string where possible; this helper is the guardrail for
 * the cases where a message is derived from a thrown value.
 */

const GENERIC = 'Something went wrong.';

/** Token-like substrings: long hex/base runs, or the obvious credential keywords. */
const TOKEN_RE = /[a-f0-9]{20,}|secret|password|api[_-]?key|token|bearer/gi;

/** ANSI escape sequences (e.g. color codes) — dropped whole. */
 
const ANSI_RE = /\x1b\[[0-9;]*m/g;
/** Any remaining control characters. */
 
const CONTROL_RE = /[\x00-\x1f\x7f]/g;

export function redactMessage(input: unknown): string {
  let raw: string;
  if (typeof input === 'string') {
    raw = input;
  } else if (input instanceof Error && typeof input.message === 'string') {
    raw = input.message;
  } else {
    return GENERIC;
  }

  // First line only — never stack frames. Strip ANSI/control noise, then collapse
  // whitespace so the toast is a single clean line.
  const firstLine = raw.split('\n', 1)[0]!;
  const cleaned = firstLine
    .replace(ANSI_RE, ' ')
    .replace(CONTROL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return GENERIC;

  const redacted = cleaned.replace(TOKEN_RE, '«redacted»').replace(/\s+/g, ' ').trim();
  return redacted === '' ? GENERIC : redacted;
}
