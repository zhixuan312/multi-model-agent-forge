import { currentMember } from '@/auth/current-member';
import { redirect } from 'next/navigation';
import { SettingsTabs } from '@/components/forge/SettingsTabs';

export default async function OrgSettingsPage() {
  const member = await currentMember();
  if (!member || member.role !== 'org_admin') redirect('/');

  return (
    <main>
      <SettingsTabs active="org" />
      <section>
        <h2>MMA Connection</h2>
        <p>Configure MMA base URL and provider models.</p>
      </section>
      <section>
        <h2>Teams</h2>
        <p>Create, list, and manage teams in this deployment.</p>
      </section>
      <section>
        <h2>Global Usage</h2>
        <p><a href="/usage">View org-wide usage dashboard</a></p>
      </section>
    </main>
  );
}
