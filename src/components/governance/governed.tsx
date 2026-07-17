'use client';

import { GOVERNANCE_REGISTRY, type GovernanceSlotId, type ResolvedGovernanceSlotState } from '@/components/governance/registry';

export interface GovernedProps {
  slotId: GovernanceSlotId;
  state: ResolvedGovernanceSlotState;
  /** When set, render that variant's sub-page instead of the slot's full preview. */
  variantId?: string;
  /** Affordance ids toggled on, for a variant's live preview. */
  enabledAffordances?: ReadonlySet<string>;
  /** The selected in-page tab (for tabbed variants like Document). */
  activeTab?: string;
}

// Presentational client seam (G3): renders ONLY the registry canonical renderer for
// the slot (or a named variant), driven by resolved `state` passed in by the caller. It
// does not read the server-only governance core and exposes no arbitrary-JSX callback.
export function Governed({ slotId, state, variantId, enabledAffordances, activeTab }: GovernedProps) {
  if (variantId) {
    const variant = GOVERNANCE_REGISTRY[slotId].variants?.find((v) => v.id === variantId);
    if (variant) return <>{variant.renderPreview(enabledAffordances, activeTab)}</>;
  }
  return <>{GOVERNANCE_REGISTRY[slotId].renderPreview(state)}</>;
}
