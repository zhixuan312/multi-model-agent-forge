import { z } from 'zod';

/**
 * Structured-output schemas for spec-stage MMA calls. Validated via Zod by the
 * dispatch handlers when parsing MMA terminal envelopes.
 */

/** fullSpecDraft — draft ALL sections in one pass + attach questions per section. */
export const FullSpecSectionSchema = z.object({
  componentKind: z.string(),
  sectionKey: z.string(),
  draftMd: z.string(),
  questions: z.array(z.string()),
});
export const FullSpecDraftSchema = z.object({
  sections: z.array(FullSpecSectionSchema),
});
export type FullSpecDraft = z.infer<typeof FullSpecDraftSchema>;
export type FullSpecSection = z.infer<typeof FullSpecSectionSchema>;

/** composeLearningCandidates — at freeze, propose learnings from the session. */
export const LearningCandidateSchema = z.object({
  bodyMd: z.string(),
  type: z.enum(['challenge', 'insight', 'decision']),
});
export const ComposeLearningsSchema = z.object({
  candidates: z.array(LearningCandidateSchema),
});
export type ComposeLearnings = z.infer<typeof ComposeLearningsSchema>;
