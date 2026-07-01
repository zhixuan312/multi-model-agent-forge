import { z } from 'zod';

/**
 * Structured-output schemas for exploration MMA calls. `ProposalSchema`
 * constrains the propose output; `SynthesisSchema` constrains the synthesis.
 */

/** Per-route prompt floors (mirror the MMA min-lengths). */
export const PROMPT_FLOORS = { investigate: 1, research: 20, journal: 10 } as const;

/**
 * One proposed task. The orchestrator is asked to emit prompts already above the
 * per-route floor; the propose endpoint re-validates and drops/re-asks below it.
 * `targetRepoId` is required for investigate, null/absent otherwise — enforced in
 * the propose layer, not here (the model may still emit a wrong shape).
 */
const RawProposedTaskSchema = z.object({
  kind: z.enum(['investigate', 'research', 'journal']),
  targetRepoId: z.string().nullable().optional(),
  target_repo_id: z.string().nullable().optional(),
  prompt: z.string(),
}).passthrough();

export const ProposedTaskSchema = RawProposedTaskSchema.transform((t) => ({
  kind: t.kind,
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

/** Compose the three sections into the artifact body markdown. */
export function composeExplorationMarkdown(s: Synthesis): string {
  const parts = ['## Background', '', s.background.trim(), ''];
  if (s.currentState.trim()) {
    parts.push('## Current state', '', s.currentState.trim(), '');
  }
  if (s.roughDirection.trim()) {
    parts.push('## Rough direction', '', s.roughDirection.trim(), '');
  }
  return parts.join('\n');
}
