import { z } from 'zod';

/**
 * The lifecycle action kinds accepted by `POST /api/projects/[id]/transition` — the
 * single mutation endpoint (spec §4.5, Decision A). `performTransition` resolves the
 * FULL action (stage/phase/note) from `allowedActions` by kind, so this schema's job
 * is to validate the kind + carry the client payload at the HTTP boundary. Per-kind
 * *payload* validation lives with each effect (its single consumer) — most payloads
 * are resolver-provided, so only the client-authoritative ones (content text,
 * component selection, execute branches) are validated deeper, in Tasks 9d/10.
 */
export const ACTION_KINDS = [
  // auto (executeDetailsAction switch)
  'dispatch_audit', 'apply_findings', 'approve_stage', 'advance_stage', 'advance_phase', 'reopen_stage',
  'dispatch_plan_author', 'validate_task', 'approve_task', 'dispatch_execute', 'dispatch_review',
  'apply_review_findings', 'dispatch_harvest', 'approve_learning', 'dispatch_record', 'mark_complete',
  // Design-phase + cross-cutting (Task 8b)
  'propose_discover_tasks', 'run_discover_tasks', 'dispatch_synthesize', 'approve_component',
  'add_learning', 'start_auto', 'take_over',
  // content edits (Task 10) — every kind here has exactly one executeDetailsAction effect
  'set_brief', 'select_components',
] as const;

/**
 * INTENTIONAL EXCEPTIONS to the single /transition endpoint — NOT lifecycle
 * transitions, so they keep dedicated routes (JSON {action,data} can't carry them):
 *   - attachment add/remove — binary/multipart FILE I/O (explore/attachment/*)
 *   - retry_pr — a git-push retry, pure git I/O (build/retry-pr)
 * And two chat/refine actions still on their routes pending Task 9 client wiring
 * (they will move to /transition then, with their effects): refine_component
 * (spec-refine dispatch), edit_plan_task (plan-task chat message).
 */

export type ActionKind = (typeof ACTION_KINDS)[number];

export const transitionSchema = z.object({
  action: z.enum(ACTION_KINDS),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type TransitionInput = z.infer<typeof transitionSchema>;
