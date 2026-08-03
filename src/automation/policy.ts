import type { Details } from '@/details/schema';

/**
 * Auto's entry point is gated to `spec/finalize` or later (spec §3 framework
 * decision — the Design phases, exploration + spec outline/craft, are hand-authored
 * and auto never drives them). The single source of this rule: `allowedActions`
 * offers `start_auto` only when this returns true, and the `start_auto` effect is
 * only reachable through that gate.
 *
 * The stage list is written out on purpose, unlike `firstUnderdoneStage`'s. The two fail
 * in opposite directions: forgetting a stage THERE stops it being checked for completion
 * (a weaker guard), while forgetting one HERE leaves it not auto-driven until someone
 * decides it should be — which is the safe default for a new stage.
 */
export function canAutoStart(d: Details): boolean {
  const { stages } = d;
  if (stages.spec.status === 'active') return stages.spec.phases.finalize.status === 'active';
  return (['plan', 'execute', 'review', 'journal'] as const).some((s) => stages[s].status === 'active');
}
