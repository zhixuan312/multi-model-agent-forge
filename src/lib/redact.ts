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

/**
 * The rules below replaced a single `/[a-f0-9]{20,}|secret|password|api[_-]?key|token|
 * bearer/gi`, which had this backwards in two ways.
 *
 * It matched the credential's NAME and left its VALUE in place, so
 * `password: hunter2` became `«redacted»: hunter2` — it hid the label and printed the
 * secret. And its only value-shaped rule was hex-only, so anything in a wider alphabet
 * survived whole. Measured against the real formats:
 *
 *   sk-proj-9aBcD3fGh1JkLmN0pQrS2tUvW4xYz          → passed through INTACT
 *   xoxb-… (a Slack bot token)                     → passed through INTACT
 *   postgres://forge:Hunter2Passw0rd@db.internal   → passed through INTACT
 *   ghp_16C7e42F292c6912E7710c838347Ae178B4a       → caught, but only because that
 *                                                    particular tail happened to be hex
 *
 * Its test asked only that `«redacted»` appear SOMEWHERE in the output, which the old
 * behaviour satisfied by redacting the word `password`.
 */

/** `label: value`, `label=value`, or `label value` — redact the VALUE, keep the label. */
const LABELLED_SECRET_RE =
  /\b(secrets?|passwords?|passwd|api[_-]?keys?|tokens?|bearer|credentials?)\b(\s*[:=]\s*|\s+)(\S+)/gi;

/** URL userinfo — `scheme://user:pass@host`. The password is the whole point. */
const URL_USERINFO_RE = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;

/**
 * A long opaque run, in ANY alphabet — this is what catches a credential nobody labelled.
 * At least one digit is required so ordinary hyphenated prose
 * ("content-security-policy") is left alone; real tokens effectively always carry one.
 * Lookarounds rather than `\b`, because `-` is not a word character and the boundary
 * would land inside the run.
 */
const OPAQUE_RUN_RE = /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g;

/** ANSI escape sequences (e.g. color codes) — dropped whole. */
const ANSI_RE = /\x1b\[[0-9;]*m/g;
/** Any remaining control characters. */
const CONTROL_RE = /[\x00-\x1f\x7f]/g;

/**
 * Duck-typed, not `instanceof Error` — the same call `errName` makes, for the same reason.
 * These helpers exist for values caught in a `catch`, where the thing thrown frequently is
 * not a same-realm `Error`: a DOMException crossing a worker or iframe boundary, or a plain
 * `{ message }` from a fetch polyfill. Both fail `instanceof` while carrying the message
 * that matters, and returning the generic string for them loses the only diagnosis there
 * was. Redaction runs on the result either way, so nothing is trusted about the source.
 */
function hasMessage(v: unknown): v is { message: string } {
  return !!v && typeof v === 'object' && 'message' in v && typeof (v as { message: unknown }).message === 'string';
}

export function redactMessage(input: unknown): string {
  let raw: string;
  if (typeof input === 'string') {
    raw = input;
  } else if (hasMessage(input)) {
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

  // Order matters: strip userinfo before the opaque-run rule can chew the host, and
  // handle labelled values before the generic run rule sees them.
  const redacted = cleaned
    .replace(URL_USERINFO_RE, '$1«redacted»@')
    .replace(LABELLED_SECRET_RE, '$1 «redacted»')
    .replace(OPAQUE_RUN_RE, '«redacted»')
    .replace(/\s+/g, ' ')
    .trim();
  return redacted === '' ? GENERIC : redacted;
}
