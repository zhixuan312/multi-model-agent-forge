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
    return [
      'You are a maintenance worker running on a schedule against this repository.',
      'Work toward the goal below: make the changes it requires, then run the repo tests/build.',
      'Leave all changes in the working tree (do NOT commit or push) — the loop runner commits + opens a PR.',
      'If the goal is already satisfied, make no changes.',
      '',
      '## Goal',
      '',
      goalMd,
    ].join('\n');
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
