import { notFound, redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { PageFrame } from '@/components/ui';
import { getComponentGovernanceView } from '@/config/component-governance-core';
import { GOVERNANCE_SLOT_IDS } from '@/components/governance/registry';
import { SlotEditor } from '../SlotEditor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One governed component on its own page (developer mode). Reached from the nested
 * "Components" list in the left rail. Org-admin only; an unknown slot id is a 404.
 */
export default async function ComponentSlotPage({ params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = await params;
  const me = await currentMember();
  if (!me || me.role !== 'org_admin') redirect('/');
  if (!GOVERNANCE_SLOT_IDS.has(slotId)) notFound();

  const view = await getComponentGovernanceView();
  const slot = view.slots.find((s) => s.slotId === slotId);
  if (!slot) notFound();

  return (
    <PageFrame
      title={slot.label}
      description={`Developer mode · ${slot.group === 'structural' ? 'Structural' : 'Leaf'} · ${slot.canonicalComponent} — lock it and every page renders it the same way.`}
      width="full"
    >
      <SlotEditor slot={slot} />
    </PageFrame>
  );
}
