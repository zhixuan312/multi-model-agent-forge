import { type StageKind } from '@/db/enums';

/**
 * The sub-phases each stage advances through, in order — the single source for BOTH
 * "what does the stepper draw" and "is this `?phase=` real".
 *
 * Every project URL is `{stage}?phase={phase}`, so each stage page has to decide whether
 * the phase in the address bar is one of its own. Four pages answered that with their own
 * `validPhases` tuple and the fifth (Reflect) answered it with a cast — five spellings of
 * a fact this module already owned for the stepper. The cast is why this is here rather
 * than a fifth tuple: `?phase=anything` reached `useState` unchecked, and because the page
 * passes `phaseParam ?? lastPhase`, a junk phase SUPPRESSED both the intended view and the
 * stage's real active phase, landing the user on the journal list with no sub-phase lit in
 * the stepper.
 *
 * TOTAL over `StageKind` (`satisfies`, not `Partial`): a seventh stage fails the build
 * here instead of rendering a stepper with no sub-phase track. `as const` keeps the keys
 * as literal types, so `parseStagePhase('journal', …)` narrows to `'journal' | 'summary'`
 * and the pages need no cast to hand the result to their client island.
 *
 * The phase keys are the keys of `details.stages.<kind>.phases` in `details/schema.ts` —
 * that Zod object is the storage contract, this is the navigation contract, and
 * `tests/projects/stage-phases.test.ts` holds them equal.
 */
// Every stage marches the same three-beat rhythm — Frame → Work → Seal — and
// every phase is a single imperative verb, harmonised across all six stages.
export const STAGE_PHASES = {
  exploration: [
    { key: 'brief', label: 'Brief' },
    { key: 'discover', label: 'Discover' },
    { key: 'synthesize', label: 'Synthesize' },
  ],
  spec: [
    { key: 'outline', label: 'Outline' },
    { key: 'craft', label: 'Craft' },
    { key: 'finalize', label: 'Finalize' },
  ],
  plan: [
    { key: 'refine', label: 'Refine' },
    { key: 'validate', label: 'Validate' },
  ],
  execute: [
    { key: 'configure', label: 'Configure' },
    { key: 'implement', label: 'Implement' },
  ],
  review: [
    { key: 'review', label: 'Review' },
  ],
  journal: [
    { key: 'journal', label: 'Journal' },
    { key: 'summary', label: 'Summary' },
  ],
} as const satisfies Record<StageKind, readonly { key: string; label: string }[]>;

/** The phase keys of one stage, as a union of literals (`'brief' | 'discover' | …`). */
export type StagePhaseKey<K extends StageKind> = (typeof STAGE_PHASES)[K][number]['key'];

/** This stage's phase keys, in order. */
export function stagePhaseKeys<K extends StageKind>(kind: K): readonly StagePhaseKey<K>[] {
  return STAGE_PHASES[kind].map((p) => p.key) as readonly StagePhaseKey<K>[];
}

/**
 * A `?phase=` value, if it names one of THIS stage's phases — `undefined` otherwise, so
 * the caller falls through to whatever it would have used without a phase in the URL.
 * Never throws and never widens: an unknown phase is absent, not a phase.
 */
export function parseStagePhase<K extends StageKind>(
  kind: K,
  raw: string | null | undefined,
): StagePhaseKey<K> | undefined {
  if (raw == null) return undefined;
  return (stagePhaseKeys(kind) as readonly string[]).includes(raw)
    ? (raw as StagePhaseKey<K>)
    : undefined;
}
