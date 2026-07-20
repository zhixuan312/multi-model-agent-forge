import { notFound, redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { PageFrame } from '@/components/ui';
import { GOVERNANCE_SLOT_IDS, GOVERNANCE_SLOT_NAV, getComponentGovernanceView, type GovernanceSlotId } from '@/components/governance/registry';
import { summarizeForSlot } from '@/governance/conformance-scan';
import { SlotEditor } from '../SlotEditor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One governed component on its own page (developer mode). Reached from the nested
 * "Components" list in the left rail. Org-admin only; an unknown slot id is a 404.
 * A slot that HAS variants has no overview of its own — it lands on its first variant.
 */
export default async function ComponentSlotPage({ params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = await params;
  const me = await currentMember();
  if (!me || me.role !== 'org_admin') redirect('/');
  if (!GOVERNANCE_SLOT_IDS.has(slotId)) notFound();

  const nav = GOVERNANCE_SLOT_NAV.find((s) => s.slotId === slotId);
  if (nav && nav.variants.length > 0) {
    redirect(`/settings/components/${slotId}/${nav.variants[0].id}`);
  }

  const view = getComponentGovernanceView();
  const slot = view.slots.find((s) => s.slotId === slotId);
  if (!slot) notFound();

  const conformance = summarizeForSlot(slotId as GovernanceSlotId);

  return (
    <PageFrame title={slot.label} width="full">
      <SlotEditor slot={slot} conformance={conformance} />
    </PageFrame>
  );
}
