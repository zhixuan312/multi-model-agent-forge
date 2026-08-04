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
 *
 * These are exactly the tiers MMA emits — no `info`. Verified against the engine's
 * `packages/core/src/unified/refiner-schemas.ts`, where every finding schema declares
 * `weight: z.enum(['critical', 'high', 'medium', 'low'])`. (That note used to hang on a
 * `FindingSeverity` alias in `spec/audit-loop.ts` that re-exported this type and had no
 * consumer at all; the note was the only load-bearing part of it, so it moved here, beside
 * the list it describes.)
 */
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

export type Severity = (typeof SEVERITY_ORDER)[number];

/**
 * Recognise a free-text severity label as a canonical tier, or `null` if it is not one.
 *
 * Severity arrives as a `weight` string on the engine envelope. On the schema-validated
 * refiner path a Zod enum guarantees it is already lowercase, but the string/fence path is
 * raw model output and is not validated anywhere — so `"Critical"` is an ordinary input,
 * not a hypothetical.
 *
 * Three readers used to do this recognition by hand and only two lower-cased first:
 *  - `isBlockingSeverity` and `ReviewStageClient` lower-cased  → `"Critical"` was critical.
 *  - `parseAuditEnvelope` tested membership of the lowercase set directly, then FILTERED
 *    non-members out → `"Critical"` was deleted before the gate ran, `hasCriticalOrHigh`
 *    came back false, and **the spec audit reported clean and advanced the stage.**
 *  - `compareSeverity` ranked by case-sensitive `indexOf` → `"Critical"` ranked with the
 *    typos and sorted to the BOTTOM of the exploration evidence list.
 *
 * Returns `null` rather than a fallback tier because the fallback is genuinely per-site:
 * the audit parse keeps the finding as `medium`, the review chip renders `low`. Choosing
 * one here would have silently imposed it on the other.
 */
export function normalizeSeverity(raw: string): Severity | null {
  const s = raw.trim().toLowerCase();
  return (SEVERITY_ORDER as readonly string[]).includes(s) ? (s as Severity) : null;
}

/**
 * Comparator placing the most severe first. An unrecognised value sorts LAST rather than
 * first: an unknown severity is not evidence of urgency, and putting it at the top would
 * let a typo dominate the list. Ranks by TIER via `normalizeSeverity`, so capitalisation
 * alone never demotes a real severity into the unknown bucket.
 */
export function compareSeverity(a: string, b: string): number {
  const rank = (s: string) => {
    const tier = normalizeSeverity(s);
    return tier === null ? SEVERITY_ORDER.length : SEVERITY_ORDER.indexOf(tier);
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
  const s = normalizeSeverity(severity);
  return s === 'critical' || s === 'high';
}
