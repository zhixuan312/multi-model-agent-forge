import { redirect } from 'next/navigation';
import { sql, eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { team } from '@/db/schema/team';
import { member } from '@/db/schema/identity';
import { PageFrame } from '@/components/ui';
import { OrgSettingsTabs } from '@/components/forge/OrgSettingsTabs';
import { TeamsPanel, type TeamRow } from './TeamsPanel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Org settings → Teams tab (Spec 2 FR-9, org_admin only). The org owner creates
 * teams — each with its first team admin — and sees the teams in this
 * deployment. MMA/voice connection and provider models are the sibling tabs.
 */
export default async function OrgSettingsPage() {
  const me = await currentMember();
  if (!me || me.role !== 'org_admin') redirect('/');

  const db = getDb();
  const [teamRows, countRows, adminRows] = await Promise.all([
    db.select().from(team).orderBy(team.name),
    db
      .select({ teamId: member.teamId, count: sql<number>`count(*)::int` })
      .from(member)
      .groupBy(member.teamId),
    db
      .select({ teamId: member.teamId, username: member.username })
      .from(member)
      .where(eq(member.role, 'team_admin')),
  ]);

  const countByTeam = new Map(countRows.map((r) => [r.teamId, r.count]));
  const adminByTeam = new Map(adminRows.map((r) => [r.teamId, r.username]));
  const teams: TeamRow[] = teamRows.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    workspaceRootPath: t.workspaceRootPath,
    gitTokenSet: t.gitTokenRef !== null,
    memberCount: countByTeam.get(t.id) ?? 0,
    adminUsername: adminByTeam.get(t.id) ?? null,
  }));

  return (
    <PageFrame title="Org settings" subnav={<OrgSettingsTabs active="teams" />} width="full">
      <TeamsPanel initialTeams={teams} />
    </PageFrame>
  );
}
