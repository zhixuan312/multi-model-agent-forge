import { Users, ShieldCheck, UserPlus, Monitor } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { listMembers, countActiveSessions } from '@/auth/members-core';
import { PageFrame } from '@/components/ui';
import { SettingsTabs } from '@/components/forge/SettingsTabs';
import { RailNote } from '@/components/patterns/feature-rail';
import { StatusDashboard } from '@/components/patterns/status-dashboard';
import { MemberTable, type MemberRowData } from './MemberTable';

const MEMBERS_NOTE = `### Roles & access

- **Everyone** — create projects, answer Q&A, run stages, collaborate
- **Admins** — also manage models, connections, members & repo cloning

### Safeguard

- **Last admin** — can't be removed or demoted; the team always keeps one`;

export default async function MembersPage() {
  await requireAdminPage();
  const members = await listMembers();
  const activeSessions = await countActiveSessions();

  const rows: MemberRowData[] = members.map((m) => ({
    id: m.id,
    username: m.username,
    displayName: m.displayName,
    avatarTint: m.avatarTint,
    isAdmin: m.isAdmin,
    createdAt: m.createdAt.toISOString(),
  }));

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const total = rows.length;
  const admins = rows.filter((m) => m.isAdmin).length;
  const recent = rows.filter((m) => new Date(m.createdAt) > cutoff).length;

  return (
    <PageFrame title="Team settings" subnav={<SettingsTabs active="members" />} width="full" fill>
      <StatusDashboard
        metrics={[
          { label: 'Team members', value: total, sublabel: 'Total members', icon: <Users />, iconTint: 'rose' },
          { label: 'Admins', value: admins, sublabel: 'With admin capability', icon: <ShieldCheck />, iconTint: 'accent' },
          { label: 'Recently added', value: recent, muted: recent === 0, sublabel: 'In the last 30 days', icon: <UserPlus />, iconTint: 'sage' },
          { label: 'Active sessions', value: activeSessions, muted: activeSessions === 0, sublabel: 'Currently active', icon: <Monitor />, iconTint: 'steel' },
        ]}
        primary={<MemberTable members={rows} />}
        aside={<RailNote icon={<ShieldCheck />}>{MEMBERS_NOTE}</RailNote>}
      />
    </PageFrame>
  );
}
