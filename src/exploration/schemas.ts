import { z } from 'zod';
import { DISCOVER_TASK_KIND } from '@/db/enums';

/**
 * Structured-output schemas for exploration MMA calls. `ProposalSchema`
 * constrains the propose output; `SynthesisSchema` constrains the synthesis.
 */

/**
 * Per-route prompt floors. These MIRROR the engine's own `task-input-schema.ts`
 * minimums (investigate 1, research 20, journal_recall 10) — a prompt Forge accepts
 * below them is one MMA will reject at dispatch. `fan-out.ts` interpolates these into
 * the propose prompt rather than restating them; it used to say "investigate ≥20",
 * which was never the floor here or in the engine.
 */
export const PROMPT_FLOORS = { investigate: 1, research: 20, journal: 10 } as const;

/**
 * One proposed task. The orchestrator is asked to emit prompts already above the
 * per-route floor; `explore-propose` re-validates and DROPS anything below it (it
 * logs `explore.proposals_rejected` — there is no re-ask).
 * `targetRepoId` is required for investigate, null/absent otherwise — enforced in
 * the propose layer, not here (the model may still emit a wrong shape).
 */
const RawProposedTaskSchema = z.object({
  kind: z.enum(DISCOVER_TASK_KIND),
  title: z.string().optional(),
  targetRepoId: z.string().nullable().optional(),
  target_repo_id: z.string().nullable().optional(),
  prompt: z.string(),
}).passthrough();

export const ProposedTaskSchema = RawProposedTaskSchema.transform((t) => ({
  kind: t.kind,
  title: t.title,
  targetRepoId: t.targetRepoId ?? t.target_repo_id ?? null,
  prompt: t.prompt,
}));
export type ProposedTask = z.infer<typeof ProposedTaskSchema>;

export const ProposalSchema = z.object({
  tasks: z.array(ProposedTaskSchema).max(10),
});
export type Proposal = z.infer<typeof ProposalSchema>;

/**
 * The synthesis output — the three sections written to exploration.md on disk.
 */
export const SynthesisSchema = z.object({
  background: z.string(),
  currentState: z.string(),
  roughDirection: z.string(),
});
export type Synthesis = z.infer<typeof SynthesisSchema>;

/** Promote inline bold labels to ## headings so the document has consistent structure. */
function promoteInlineHeadings(md: string): string {
  return md
    .replace(/^\*\*currentState\*\*[:\s]*/gim, '## Current state\n\n')
    .replace(/^\*\*current\s*state\*\*[:\s]*/gim, '## Current state\n\n')
    .replace(/^\*\*roughDirection\*\*[:\s]*/gim, '## Rough direction\n\n')
    .replace(/^\*\*rough\s*direction\*\*[:\s]*/gim, '## Rough direction\n\n');
}

/** Compose the three sections into the artifact body markdown. */
export function composeExplorationMarkdown(s: Synthesis): string {
  const bg = promoteInlineHeadings(s.background.trim());
  const parts = ['## Background', '', bg, ''];
  if (s.currentState.trim()) {
    parts.push('## Current state', '', s.currentState.trim(), '');
  }
  if (s.roughDirection.trim()) {
    parts.push('## Rough direction', '', s.roughDirection.trim(), '');
  }
  return parts.join('\n');
}
