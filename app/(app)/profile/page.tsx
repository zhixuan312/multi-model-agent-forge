import { redirect } from 'next/navigation';
import { ShieldCheck, CalendarClock, Monitor } from 'lucide-react';
import { currentMember } from '@/auth/current-member';
import { getProfileMeta } from '@/auth/profile-core';
import { PageFrame } from '@/components/ui';
import { formatDate, formatRelative } from '@/lib/format-relative';
import { ProfileForm } from './ProfileForm';

/**
 * Profile (Spec 1 §Profile / profile.html). Same surface as Team Settings: a
 * STATUS row of profile facts, then a 2/3 ∣ 1/3 row — the Account + Password
 * cards (Primary) and the equal-rights note + Sign-out (Rail). Profile is the
 * authenticated member, so it stays on the real auth path (not mocked) — editing
 * the real member keeps both this page and the sidebar in sync.
 */
export default async function ProfilePage() {
  const member = await currentMember();
  if (!member) redirect('/login');
  const meta = await getProfileMeta(member.id);

  const roleLabel = member.role === 'org_admin' ? 'Org admin' : member.role === 'team_admin' ? 'Team admin' : 'Member';
  const roleSublabel = member.role === 'org_admin' ? 'Manages all teams & config' : member.role === 'team_admin' ? 'Manages this team & config' : 'Create & collaborate';

  return (
    <PageFrame title="Profile" width="full">
      <ProfileForm
        member={member}
        metrics={[
          { label: 'Role', value: roleLabel, sublabel: roleSublabel, icon: <ShieldCheck />, iconTint: 'accent' },
          { label: 'Member since', value: meta.createdAt ? formatDate(meta.createdAt) : '—', muted: !meta.createdAt, sublabel: meta.createdAt ? formatRelative(meta.createdAt) : 'Joined the team', icon: <CalendarClock />, iconTint: 'sage' },
          { label: 'Active sessions', value: meta.activeSessions, muted: meta.activeSessions === 0, sublabel: 'Across your devices', icon: <Monitor />, iconTint: 'steel' },
        ]}
      />
    </PageFrame>
  );
}
