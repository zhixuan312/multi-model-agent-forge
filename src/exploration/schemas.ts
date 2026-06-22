import { z } from 'zod';

/**
 * Structured-output schemas (Zod 4) for the exploration orchestrator calls
 * (Spec 5 flows B + E). `ProposalSchema` constrains the propose main-agent call;
 * `SynthesisSchema` constrains the synthesis call. Passed to
 * `AnthropicClient.parse` via `zodOutputFormat`.
 */

/** Per-route prompt floors (mirror the MMA min-lengths). */
export const PROMPT_FLOORS = { investigate: 1, research: 20, journal: 10 } as const;

/**
 * One proposed task. The orchestrator is asked to emit prompts already above the
 * per-route floor; the propose endpoint re-validates and drops/re-asks below it.
 * `targetRepoId` is required for investigate, null/absent otherwise — enforced in
 * the propose layer, not here (the model may still emit a wrong shape).
 */
export const ProposedTaskSchema = z.object({
  kind: z.enum(['investigate', 'research', 'journal']),
  targetRepoId: z.string().nullable().optional(),
  prompt: z.string(),
});
export type ProposedTask = z.infer<typeof ProposedTaskSchema>;

export const ProposalSchema = z.object({
  tasks: z.array(ProposedTaskSchema).max(10),
});
export type Proposal = z.infer<typeof ProposalSchema>;

/** A single re-asked task (the one constrained repair pass for a sub-floor prompt). */
export const RepairedTaskSchema = z.object({
  prompt: z.string(),
});
export type RepairedTask = z.infer<typeof RepairedTaskSchema>;

/**
 * The synthesis output — the three product sections (product.md §7.3). The
 * combined markdown is what lands in `artifact(kind='exploration')`.
 */
export const SynthesisSchema = z.object({
  background: z.string(),
  currentState: z.string(),
  roughDirection: z.string(),
});
export type Synthesis = z.infer<typeof SynthesisSchema>;

/** Compose the three sections into the artifact body markdown. */
export function composeExplorationMarkdown(s: Synthesis): string {
  return [
    '## Background',
    '',
    s.background.trim(),
    '',
    '## Current state',
    '',
    s.currentState.trim(),
    '',
    '## Rough direction',
    '',
    s.roughDirection.trim(),
    '',
  ].join('\n');
}
