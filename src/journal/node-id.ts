/**
 * What a journal node id is: exactly four digits, matching MMA's frontmatter `id` format.
 *
 * The rule was written out as a bare `/^\d{4}$/` in four places, two of which are the
 * defence-in-depth pair guarding filesystem access — the API route rejects a bad id before
 * the reader is called, and the reader rejects it again as the backstop. A pair like that
 * is only defence-in-depth while both halves agree; written twice, one can be loosened
 * without the other, and the outer guard is exactly the one someone would relax to "fix"
 * a legitimate id it happened to reject.
 *
 * Four digits with no upper bound is deliberate (F17): there is no <1000-node cap.
 */
export const NODE_ID_RE = /^\d{4}$/;

/** Whether `id` is a well-formed node id. Rejects `../etc`, `12`, `abc`, `12345`. */
export function isNodeId(id: string): boolean {
  return NODE_ID_RE.test(id);
}
