import { z } from 'zod';

/**
 * The structured-output schema the orchestrator (Anthropic main model) returns
 * when authoring the build plan from the locked spec (Spec 7 §Plan authoring).
 *
 * Each task targets EXACTLY ONE repo (`targetRepoId`); a unit spanning two repos
 * is two tasks wired by `dependsOn`. `reviewPolicy` defaults to `full`; the model
 * sets `none` ONLY for a task the plan explicitly marks "downstream errors
 * expected, fixed by a later task".
 */
export const PlanTaskDraftSchema = z.object({
  title: z.string().min(1).describe('The task heading text (becomes the verbatim ATX heading / taskDescriptor). NO git commit/add/push steps.'),
  detail: z.string().optional().default('').describe('A short body describing the CODE CHANGES only — never git add/commit/push.'),
  targetRepoId: z.string().min(1).describe('The ONE repo this task targets (a repo id from the provided project repo set).'),
  dependsOn: z.array(z.string()).describe('Zero or more sibling task titles this task depends on (by exact title).'),
  reviewPolicy: z.enum(['reviewed', 'none']).describe("perTaskReviewPolicy. 'reviewed' unless the task is intentionally-incomplete (downstream errors expected, fixed later) → 'none'."),
});

export const PlanDraftSchema = z.object({
  tasks: z.array(PlanTaskDraftSchema).min(1),
});

export type PlanTaskDraft = z.infer<typeof PlanTaskDraftSchema>;
export type PlanDraft = z.infer<typeof PlanDraftSchema>;
