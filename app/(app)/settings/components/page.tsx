import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { PageFrame } from '@/components/ui';
import { OrgSettingsTabs } from '@/components/forge/OrgSettingsTabs';
import { getComponentGovernanceView } from '@/config/component-governance-core';
import { ComponentsGovernancePanel } from './ComponentsGovernancePanel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ComponentsSettingsPage() {
  const me = await currentMember();
  if (!me || me.role !== 'org_admin') redirect('/');

  // Server component reads the governance view from the server-only core (allowed here)
  // and hands it to the client panel as an initial snapshot.
  const initialView = await getComponentGovernanceView();

  return (
    <PageFrame title="Org settings" subnav={<OrgSettingsTabs active="components" />} width="full">
      <ComponentsGovernancePanel initialView={initialView} />
    </PageFrame>
  );
}
