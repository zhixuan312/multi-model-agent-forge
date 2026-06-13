import { redirect } from 'next/navigation';
import { ShieldCheck, CalendarClock, Monitor } from 'lucide-react';
import { currentMember } from '@/auth/current-member';
import { getProfileMeta } from '@/auth/profile-core';
import { PageFrame, MetricCard } from '@/components/ui';
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

  return (
    <PageFrame title="Profile" width="full">
      <div className="flex flex-col gap-4">
        {/* STATUS — profile facts */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard label="Role" value={member.isAdmin ? 'Admin' : 'Member'} sublabel={member.isAdmin ? 'Manages team & config' : 'Create & collaborate'} icon={<ShieldCheck />} iconTint="accent" />
          <MetricCard label="Member since" value={meta.createdAt ? formatDate(meta.createdAt) : '—'} muted={!meta.createdAt} sublabel={meta.createdAt ? formatRelative(meta.createdAt) : 'Joined the team'} icon={<CalendarClock />} iconTint="sage" />
          <MetricCard label="Active sessions" value={meta.activeSessions} muted={meta.activeSessions === 0} sublabel="Across your devices" icon={<Monitor />} iconTint="steel" />
        </div>

        <ProfileForm member={member} />
      </div>
    </PageFrame>
  );
}
