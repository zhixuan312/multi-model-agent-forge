'use client';

import { GOVERNANCE_REGISTRY, type GovernanceSlotId, type ResolvedGovernanceSlotState } from '@/components/governance/registry';

export interface GovernedProps {
  slotId: GovernanceSlotId;
  state: ResolvedGovernanceSlotState;
}

// Presentational client seam (G3): renders ONLY the registry canonical renderer for
// the slot, driven by resolved `state` passed in by the caller. It does not read the
// server-only governance core and exposes no arbitrary-JSX callback.
export function Governed({ slotId, state }: GovernedProps) {
  return <>{GOVERNANCE_REGISTRY[slotId].renderPreview(state)}</>;
}
