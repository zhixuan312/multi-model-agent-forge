/**
 * Types for the Recall tab's standing content — the member's pinned answers and
 * the team's auto-derived FAQs. Pure types (no runtime) so any layer can import.
 *
 * A pin is a refreshable cache: `answerMd` is the synthesis at last refresh,
 * `journalLogCount` the freshness marker, and `stale` is server-derived (the
 * journal has had writes since the answer). FAQs are `{ question, count }` derived
 * live from recall history.
 */

/**
 * One recalled learning — a `results[]` entry from the recall answer. Persisted
 * on a pin (as `findings`) so a pinned answer renders at the SAME fidelity as the
 * live recall (synthesis + per-learning breakdown + sources), not a degraded one.
 */
export interface PinnedFinding {
  learning: string;
  context: string;
  relevance: string;
  nodeId: string;
  category: string;
  status: string;
  /** v5.4 field — weight (critical/high/medium/low). */
  weight?: string;
}

export interface PinnedView {
  id: string;
  question: string;
  /** Cached synthesis (markdown) at last refresh. */
  answerMd: string;
  /** The per-learning breakdown at last refresh (same shape the live answer renders). */
  findings: PinnedFinding[];
  /** Cited node ids at last refresh. */
  citationIds: string[];
  /** Number of `log.md` entries when the answer was cached (freshness marker). */
  journalLogCount: number;
  /** True when the journal has had writes since the cached answer. */
  stale: boolean;
}

export interface FaqView {
  question: string;
  count: number;
}
