import { z } from 'zod';
import type { LoopKind } from '@/db/enums';

/**
 * Loop-kind registry — the single extensibility seam for Loops (see
 * docs/superpowers/specs/2026-06-15-loops-design.md §3.4). Each kind declares its
 * label, a Zod schema for its `loop.config` blob, and how its config becomes the
 * MMA worker prompt. Adding a kind = one entry here + a `LOOP_KIND` enum value —
 * no schema change. Mirrors the unified-task TYPE_REGISTRY pattern.
 */
export interface LoopKindDef {
  /** Human label for the UI. */
  label: string;
  /** Validates `loop.config` for this kind. */
  configSchema: z.ZodTypeAny;
  /** Turns the (validated) config into the prompt dispatched to the MMA worker. */
  buildPrompt: (config: unknown) => string;
}

/** `maintenance` config — a free-text quality/cleanup goal. */
export const maintenanceConfigSchema = z.object({
  goalMd: z.string().trim().min(1),
});
export type MaintenanceConfig = z.infer<typeof maintenanceConfigSchema>;

const maintenance: LoopKindDef = {
  label: 'Maintenance',
  configSchema: maintenanceConfigSchema,
  buildPrompt: (config) => {
    const { goalMd } = maintenanceConfigSchema.parse(config);
    return `Role: You are a maintenance worker for a Forge scheduled loop. You fix, clean, or improve a repository toward a specific goal.

Task: Investigate the repository, understand its structure and test framework, make the changes required by the goal, then verify your changes pass the build and tests BEFORE declaring done.

Context: You are running in an isolated worktree of the repository. The loop runner will commit your changes and open a PR — do NOT commit or push yourself. If the goal is already satisfied (tests already pass, code already clean), make no changes.

Input:

--- Goal ---
${goalMd}
--- End Goal ---

Constraints:
- INVESTIGATE FIRST — read package.json / Makefile / pyproject.toml to find the test/build command
- Find and read the ACTUAL failing tests before editing anything — understand WHY they fail
- After making changes, RUN the test/build command yourself and verify it passes
- If tests still fail after your changes, read the error output and fix it — do not declare done while tests fail
- Leave all changes in the working tree — the loop runner handles commit + PR
- If the goal is already satisfied, make no changes

Output format:
Make your changes directly to the files. Run the verification command. Report what you changed and whether verification passed.`;
  },
};

export const LOOP_KINDS: Record<LoopKind, LoopKindDef> = {
  maintenance,
};

export function getLoopKind(kind: LoopKind): LoopKindDef {
  return LOOP_KINDS[kind];
}

export type ParseConfigResult = { ok: true; data: unknown } | { ok: false };

/** Validate a raw config blob against the kind's schema. */
export function parseLoopConfig(kind: LoopKind, config: unknown): ParseConfigResult {
  const parsed = getLoopKind(kind).configSchema.safeParse(config);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}
