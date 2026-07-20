import { notFound, redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { PageFrame } from '@/components/ui';
import { GOVERNANCE_SLOT_IDS, GOVERNANCE_SLOT_NAV, getComponentGovernanceView, type GovernanceSlotId } from '@/components/governance/registry';
import { summarizeForSlot } from '@/governance/conformance-scan';
import { SlotEditor } from '../../SlotEditor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A single variant of a governed component — the 3rd sidebar layer (e.g. one App-shell
 * header layout, one Content-area page layout). Org-admin only; unknown slot/variant → 404.
 */
export default async function ComponentVariantPage({
  params,
}: {
  params: Promise<{ slotId: string; variantId: string }>;
}) {
  const { slotId, variantId } = await params;
  const me = await currentMember();
  if (!me || me.role !== 'org_admin') redirect('/');
  if (!GOVERNANCE_SLOT_IDS.has(slotId)) notFound();

  const nav = GOVERNANCE_SLOT_NAV.find((s) => s.slotId === slotId);
  const variant = nav?.variants.find((v) => v.id === variantId);
  if (!variant) notFound();

  const view = getComponentGovernanceView();
  const slot = view.slots.find((s) => s.slotId === slotId);
  if (!slot) notFound();

  const conformance = summarizeForSlot(slotId as GovernanceSlotId);

  return (
    <PageFrame title={`${slot.label} · ${variant.label}`} width="full">
      <SlotEditor slot={slot} variantId={variantId} conformance={conformance} />
    </PageFrame>
  );
}
