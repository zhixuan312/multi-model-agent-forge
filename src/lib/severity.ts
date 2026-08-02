/**
 * Finding severity ordering — one definition for client and server.
 *
 * This existed twice: as an exported array in `components/patterns/findings.tsx` and as an
 * inline `Record<string, number>` inside `exploration/explore-core.ts`. They agreed, but
 * only by coincidence — `findings.tsx` is a `'use client'` module and `explore-core` is
 * server code, so the constant could not be shared across that boundary and was rewritten
 * instead. This module has no imports, so both sides can use it.
 *
 * The order is most-severe-first, which is also the display order.
 */
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

export type Severity = (typeof SEVERITY_ORDER)[number];

/**
 * Comparator placing the most severe first. An unrecognised value sorts LAST rather than
 * first: an unknown severity is not evidence of urgency, and putting it at the top would
 * let a typo dominate the list.
 */
export function compareSeverity(a: string, b: string): number {
  const rank = (s: string) => {
    const i = (SEVERITY_ORDER as readonly string[]).indexOf(s);
    return i === -1 ? SEVERITY_ORDER.length : i;
  };
  return rank(a) - rank(b);
}

/**
 * Whether a finding BLOCKS — the rule that decides whether an audit/review pass is clean
 * or must be revised. Critical and high block; medium and low are advisory.
 *
 * This predicate was written out three times (`audit-loop`, `PlanStageClient`,
 * `review-findings` — the last of which named the concept `hasBlockingReviewFindings`
 * while inlining the comparison). Case-insensitive because the review path reads a
 * free-text `weight` off the engine envelope rather than a typed column.
 */
export function isBlockingSeverity(severity: string): boolean {
  const s = severity.toLowerCase();
  return s === 'critical' || s === 'high';
}
