import { z } from 'zod';

/**
 * The four structured-output schemas (Zod 4) for the orchestrator's opus calls
 * (Spec 4 / technical.md §7.2). Each is passed to `AnthropicClient.parse` via
 * `zodOutputFormat`, so the model is constrained to emit exactly this shape and
 * the SDK returns a validated `parsed_output`.
 *
 * Part A (4a) uses `GenerateQuestions`, `AssessAnswers`, `DraftSection`.
 * `ComposeLearnings` is defined here (it's the fourth orchestrator schema) but
 * consumed by Part B's learnings curation.
 */

/** 1. generateQuestions — produce grounded questions for ONE section. */
export const GenerateQuestionsSchema = z.object({
  questions: z
    .array(z.string())
    .describe('Grounded questions for this section. EMPTY when intent + exploration already suffice.'),
  aiSatisfiedWithoutAnswers: z
    .boolean()
    .describe('True iff context already fully covers this section (zero-question fast path).'),
  grounding: z
    .string()
    .describe('One-line note on what context was used (intent/exploration/prior sections).'),
});
export type GenerateQuestions = z.infer<typeof GenerateQuestionsSchema>;

/** 2. assessAnswers — re-assess after member answers. */
export const AssessAnswersSchema = z.object({
  aiSatisfied: z.boolean(),
  missingInfo: z
    .array(z.string())
    .describe('What is still unanswered or ambiguous; empty when satisfied.'),
  followUpQuestions: z
    .array(z.string())
    .describe('Next-round questions; empty when satisfied or nothing left to ask.'),
});
export type AssessAnswers = z.infer<typeof AssessAnswersSchema>;

/** 3. draftSection — produce the section's markdown body. */
export const DraftSectionSchema = z.object({
  draftMd: z
    .string()
    .describe(
      'Markdown for THIS section only, under its template heading. For flow_charts, include a ```mermaid block.',
    ),
});
export type DraftSection = z.infer<typeof DraftSectionSchema>;

/** 4. fullSpecDraft — draft ALL sections in one pass + attach questions per section. */
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

/** 5. sectionRefinement — refine one section after user answers. */
export const SectionRefinementSchema = z.object({
  draftMd: z.string().describe('The revised draft for this section incorporating the user feedback.'),
  questions: z.array(z.string()).describe('Further questions, or empty if the section is now complete.'),
});
export type SectionRefinement = z.infer<typeof SectionRefinementSchema>;

/** 6. composeLearningCandidates — at freeze, propose learnings from the session. */
export const LearningCandidateSchema = z.object({
  bodyMd: z.string(),
  type: z.enum(['challenge', 'insight', 'decision']),
});
export const ComposeLearningsSchema = z.object({
  candidates: z.array(LearningCandidateSchema),
});
export type ComposeLearnings = z.infer<typeof ComposeLearningsSchema>;
