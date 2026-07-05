import type { Details } from '@/details/schema';

/**
 * Auto's entry point is gated to `spec/finalize` or later (spec §3 framework
 * decision — the Design phases, exploration + spec outline/craft, are hand-authored
 * and auto never drives them). The single source of this rule: `allowedActions`
 * offers `start_auto` only when this returns true, and the `start_auto` effect is
 * only reachable through that gate.
 */
export function canAutoStart(d: Details): boolean {
  const { stages } = d;
  if (stages.spec.status === 'active') return stages.spec.phases.finalize.status === 'active';
  return (['plan', 'execute', 'review', 'journal'] as const).some((s) => stages[s].status === 'active');
}
