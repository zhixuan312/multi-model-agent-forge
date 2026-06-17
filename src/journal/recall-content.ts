/**
 * Types for the Recall tab's standing content — the user's pinned Q&A and the
 * team's frequently-asked questions. These are persisted artifacts (not the live
 * LLM recall); there is no backend for them yet, so the page ships empty arrays.
 * Pure types — no runtime — so any layer can import them.
 */

export interface PinnedQA {
  id: string;
  question: string;
  /** Markdown answer. */
  answer: string;
  /** Cited node ids (resolved to title + status against the in-page index). */
  citationIds: string[];
}

export interface FaqItem {
  id: string;
  question: string;
}
