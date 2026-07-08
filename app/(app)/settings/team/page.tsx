import { currentMember } from '@/auth/current-member';
import { redirect } from 'next/navigation';
import { SettingsTabs } from '@/components/forge/SettingsTabs';

export default async function TeamSettingsPage() {
  const member = await currentMember();
  if (!member || member.role === 'org_admin') redirect('/');

  return (
    <main>
      <SettingsTabs active="team" />
      <section>
        <h2>Git Token</h2>
        <p>Configure the git credential for this team's repositories.</p>
      </section>
      <section>
        <h2>Workspace Path</h2>
        <p>Set the local filesystem root for this team's work.</p>
      </section>
      <section>
        <h2>Repositories</h2>
        <p>Register and manage repositories for this team.</p>
      </section>
      <section>
        <h2>Members</h2>
        <p>Add, remove, and manage members of this team.</p>
      </section>
    </main>
  );
}
