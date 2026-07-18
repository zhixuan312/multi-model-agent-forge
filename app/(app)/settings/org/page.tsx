import { redirect } from 'next/navigation';
import { sql, eq } from 'drizzle-orm';
import { Users } from 'lucide-react';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { team } from '@/db/schema/team';
import { member } from '@/db/schema/identity';
import { PageFrame } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell } from '@/components/patterns/stage-shell';
import { OrgSettingsTabs } from '@/components/forge/OrgSettingsTabs';
import { TeamsPanel, type TeamRow } from './TeamsPanel';

const TEAMS_NOTE = `### Teams

- **Own space** — each team keeps its projects, workspace, and journal to itself
- **No crossover** — one team never sees another team's work

### Adding a team

- **Set up its admin** — you create their username and first password
- **Then hand off** — the admin adds members and connects the git repo

### Who can do what

- **You (org admin)** — shared setup plus every team's usage
- **Team admin** — runs a single team
- **Forge** — the built-in agent, never an admin`;

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
      <StageShell
        align="start"
        note={<RailNote icon={<Users />}>{TEAMS_NOTE}</RailNote>}
      >
<TeamsPanel initialTeams={teams} />
      </StageShell>
    </PageFrame>
  );
}
