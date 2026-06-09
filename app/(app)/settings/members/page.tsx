import { requireAdminPage } from '@/auth/require-admin';
import { listMembers } from '@/auth/members-core';
import { PageHeader } from '@/components/forge/PageHeader';
import { SettingsTabs } from '@/components/forge/SettingsTabs';
import { AddMemberForm } from './AddMemberForm';
import { MemberRow, type MemberRowData } from './MemberRow';

/**
 * Team Settings → Members (Spec 1 §Members CRUD / members.html). Admin-gated by
 * `requireAdminPage`. Lists members (username, display name, admin badge,
 * created) with row actions + an add-member card. The list renders via RSC; the
 * mutations are admin API route handlers driven by the client pieces.
 */
export default async function MembersPage() {
  await requireAdminPage();
  const members = await listMembers();
  const rows: MemberRowData[] = members.map((m) => ({
    id: m.id,
    username: m.username,
    displayName: m.displayName,
    avatarTint: m.avatarTint,
    isAdmin: m.isAdmin,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <>
      <PageHeader title="Team settings" />
      <SettingsTabs active="members" />

      <div className="mb-1">
        <h2 className="font-serif text-xl font-semibold text-ink">Team members</h2>
        <p className="mt-1 max-w-[560px] text-sm text-ink-soft">
          Everyone logs in with their own username — used for ownership, presence, and the action
          log. Equal rights for all.
        </p>
      </div>

      <div data-testid="members-list" className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {rows.map((m) => (
          <MemberRow key={m.id} member={m} />
        ))}
      </div>

      <AddMemberForm />
    </>
  );
}
