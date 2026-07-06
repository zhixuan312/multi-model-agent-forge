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
  'start_auto', 'take_over',
  // content edits (Task 10) — pure-content writes routed through the executor. Message-
  // thread content (plan-task chat, component chat) stays on its own route: the insert
  // must return the new message id for the client's optimistic-echo dedup, which a
  // fire-and-forget transition cannot carry.
  'set_brief', 'select_components', 'refine_component',
] as const;

export const transitionSchema = z.object({
  action: z.enum(ACTION_KINDS),
  data: z.record(z.string(), z.unknown()).optional(),
});
