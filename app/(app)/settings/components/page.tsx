import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { GOVERNANCE_SLOT_NAV } from '@/components/governance/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Components" index — a bare entry point. Developer mode has one page per component
 * (reached from the nested left-rail list), so the index just lands the user on the
 * first governed slot. Org-admin only.
 */
export default async function ComponentsIndexPage() {
  const me = await currentMember();
  if (!me || me.role !== 'org_admin') redirect('/');
  redirect(`/settings/components/${GOVERNANCE_SLOT_NAV[0].slotId}`);
}
