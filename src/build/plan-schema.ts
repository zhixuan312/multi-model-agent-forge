import { z } from 'zod';

/**
 * Structured-output schema for plan authoring. Each task targets ONE repo;
 * cross-repo work is two tasks wired by `dependsOn`. `reviewPolicy` is
 * `reviewed` by default; `none` only for intentionally-incomplete tasks.
 */
export const PlanTaskDraftSchema = z.object({
  title: z.string().min(1).describe('The task heading text (becomes the verbatim ATX heading / taskDescriptor). NO git commit/add/push steps.'),
  detail: z.string().optional().default('').describe('A short body describing the CODE CHANGES only — never git add/commit/push.'),
  phase: z.string().optional().describe('The track/phase this task belongs to (e.g. "Track A — Data layer"). Tasks in the same phase are grouped in the UI.'),
  targetRepoId: z.string().min(1).describe('The ONE repo this task targets (a repo id from the provided project repo set).'),
  dependsOn: z.array(z.string()).describe('Zero or more sibling task titles this task depends on (by exact title).'),
  reviewPolicy: z.enum(['reviewed', 'none']).describe("perTaskReviewPolicy. 'reviewed' unless the task is intentionally-incomplete (downstream errors expected, fixed later) → 'none'."),
});

export const PlanDraftSchema = z.object({
  tasks: z.array(PlanTaskDraftSchema).min(1),
});

export type PlanTaskDraft = z.infer<typeof PlanTaskDraftSchema>;
export type PlanDraft = z.infer<typeof PlanDraftSchema>;
