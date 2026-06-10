import { requireAdminPage } from '@/auth/require-admin';
import { listMembers } from '@/auth/members-core';
import { PageFrame, SectionTitle, Grid } from '@/components/ui';
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
    <PageFrame title="Team settings" subnav={<SettingsTabs active="members" />}>
      <div className="flex flex-col gap-6">
        <SectionTitle description="Everyone logs in with their own username — used for ownership, presence, and the action log. Equal rights for all.">
          Team members
        </SectionTitle>

        <Grid min="320px" gap="sm" data-testid="members-list">
          {rows.map((m) => (
            <MemberRow key={m.id} member={m} />
          ))}
        </Grid>

        <AddMemberForm />
      </div>
    </PageFrame>
  );
}
