import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { GitBranch, FolderTree, Boxes, Users } from 'lucide-react';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { team } from '@/db/schema/team';
import { member } from '@/db/schema/identity';
import { repo } from '@/db/schema/workspace';
import { PageFrame, MetricCard, MetricRow } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { TeamSettingsTabs } from '@/components/forge/TeamSettingsTabs';
import { GitTokenForm } from './GitTokenForm';
import { WorkspaceForm } from './WorkspaceForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEAM_NOTE = `### This team

- **Git token** — clones and pulls every repo the team builds in
- **Workspace** — where the team's repos and journal live on disk

### Also here

- **Members** — add teammates and pick admins on the Members tab
- **Repositories** — connect repos from the Workspace page

### Kept private

- **Your team only** — no other team ever sees this team's work`;

/**
 * Team settings (Spec 2 FR-9, team-admin only for that team). The team admin
 * manages their own team's config: git token, workspace path, repositories, and
 * members. Git token + workspace path edit inline; the heavier repository and
 * member surfaces link out to their existing management pages. Org-level config
 * (MMA connection, provider models, teams) lives under Org settings.
 */
export default async function TeamSettingsPage() {
  const me = await currentMember();
  if (!me) redirect('/login');
  if (me.role !== 'team_admin' || !me.teamId) redirect('/');

  const db = getDb();
  const [teamRow] = await db.select().from(team).where(eq(team.id, me.teamId)).limit(1);
  if (!teamRow) redirect('/');

  const [repoCountRows, memberCountRows] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(repo).where(eq(repo.teamId, me.teamId)),
    db.select({ c: sql<number>`count(*)::int` }).from(member).where(eq(member.teamId, me.teamId)),
  ]);
  const repoCount = repoCountRows[0]?.c ?? 0;
  const memberCount = memberCountRows[0]?.c ?? 0;

  return (
    <PageFrame title="Team settings" subnav={<TeamSettingsTabs active="team" />} width="full">
      <div className="flex flex-col gap-4">
        {/* STATUS — four equal metric boxes, same shell as the org tabs */}
        <MetricRow>
          <MetricCard
            label="Git access"
            value={teamRow.gitTokenRef ? 'Ready' : 'No token'}
            muted={!teamRow.gitTokenRef}
            sublabel="Clone & pull"
            icon={<GitBranch />}
            iconTint="sage"
          />
          <MetricCard label="Workspace" value={teamRow.slug} sublabel="Local root" icon={<FolderTree />} iconTint="steel" />
          <MetricCard
            label="Repositories"
            value={repoCount}
            muted={repoCount === 0}
            sublabel="Registered"
            icon={<Boxes />}
            iconTint="accent"
          />
          <MetricCard
            label="Members"
            value={memberCount}
            muted={memberCount === 0}
            sublabel="On this team"
            icon={<Users />}
            iconTint="rose"
          />
        </MetricRow>

        {/* PRIMARY (2/3) ∣ RAIL (1/3) — same shell as Connections / Models. The
            two config cards sit side by side so neither stretches sparse. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
          <div className="grid gap-4 sm:grid-cols-2 sm:items-start lg:col-span-2">
            <GitTokenForm tokenSet={teamRow.gitTokenRef !== null} />
            <WorkspaceForm current={teamRow.workspaceRootPath} />
          </div>

          <div className="flex flex-col gap-4">
            <RailNote icon={<GitBranch />}>{TEAM_NOTE}</RailNote>
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
