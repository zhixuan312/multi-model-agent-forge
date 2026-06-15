import { Users, ShieldCheck, UserPlus, Monitor } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { listMembers, countActiveSessions } from '@/auth/members-core';
import { PageFrame, MetricCard } from '@/components/ui';
import { SettingsTabs } from '@/components/forge/SettingsTabs';
import { SettingsAccessNote } from '@/components/forge/SettingsAccessNote';
import { MemberTable, type MemberRowData } from './MemberTable';

const MEMBERS_NOTE = `### Roles & access

- **Everyone** — create projects, answer Q&A, run stages, collaborate
- **Admins** — also manage models, connections, members & repo cloning

### Safeguard

- **Last admin** — can't be removed or demoted; the team always keeps one`;

/**
 * Team Settings → Members (Spec 1 §Members CRUD). Admin-gated. STATUS row (4
 * equal metric boxes), then a 2/3 ∣ 1/3 row — the member DataTable (Primary) and
 * the add-member form + equal-rights guidance (Rail).
 */
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
      <div className="flex h-full min-h-0 flex-col gap-4">
        {/* STATUS — four equal metric boxes */}
        <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Team members" value={total} sublabel="Total members" icon={<Users />} iconTint="rose" />
          <MetricCard label="Admins" value={admins} sublabel="With admin capability" icon={<ShieldCheck />} iconTint="accent" />
          <MetricCard label="Recently added" value={recent} muted={recent === 0} sublabel="In the last 30 days" icon={<UserPlus />} iconTint="sage" />
          <MetricCard label="Active sessions" value={activeSessions} muted={activeSessions === 0} sublabel="Currently active" icon={<Monitor />} iconTint="steel" />
        </div>

        {/* PRIMARY (2/3) ∣ RAIL (1/3) — fills to the page bottom; the table scrolls */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
          <div className="flex min-h-0 flex-col lg:col-span-2">
            <MemberTable members={rows} />
          </div>
          <div className="flex min-h-0 flex-col gap-4">
            <SettingsAccessNote body={MEMBERS_NOTE} />
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
