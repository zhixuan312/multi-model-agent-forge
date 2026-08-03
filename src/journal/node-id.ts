/**
 * What a journal node id is: exactly four digits, matching MMA's frontmatter `id` format.
 *
 * The rule was written out as a bare `/^\d{4}$/` in several places, two of which are the
 * defence-in-depth pair guarding filesystem access — the API route rejects a bad id before
 * the reader is called, and the reader rejects it again as the backstop. A pair like that
 * is only defence-in-depth while both halves agree; written twice, one can be loosened
 * without the other, and the outer guard is exactly the one someone would relax to "fix"
 * a legitimate id it happened to reject.
 *
 * Four digits with no upper bound is deliberate (F17): there is no <1000-node cap.
 */
/**
 * The id pattern as a SOURCE fragment, for the regexes that must embed it — a node
 * filename (`0001-title.md`), a `log.md` line, a `nodes/0001-….md` citation path. Those
 * cannot call `isNodeId` mid-pattern, and each was written out as its own `\d{4}`, which
 * is the duplication this module exists to prevent.
 */
export const NODE_ID_PATTERN = '\\d{4}';

export const NODE_ID_RE = new RegExp(`^${NODE_ID_PATTERN}$`);

/** Whether `id` is a well-formed node id. Rejects `../etc`, `12`, `abc`, `12345`. */
export function isNodeId(id: string): boolean {
  return NODE_ID_RE.test(id);
}
