import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { Plug, BarChart3 } from 'lucide-react';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { team } from '@/db/schema/team';
import { member } from '@/db/schema/identity';
import { getConnections } from '@/config/connections-core';
import { PageFrame, Card, CardContent, Title, Text, Mono, buttonVariants } from '@/components/ui';
import { SettingsTabs } from '@/components/forge/SettingsTabs';
import { TeamsPanel, type TeamRow } from './TeamsPanel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Org settings (Spec 2, org_admin only). The org owner manages the shared infra:
 * the teams in this deployment, the MMA connection + provider models every team
 * runs through, and a jump to the org-wide usage dashboard. Team-scoped config
 * (git token, workspace, repos, members) lives under Team settings.
 */
export default async function OrgSettingsPage() {
  const me = await currentMember();
  if (!me || me.role !== 'org_admin') redirect('/');

  const db = getDb();
  const [teamRows, countRows, conn] = await Promise.all([
    db.select().from(team).orderBy(team.name),
    db
      .select({ teamId: member.teamId, count: sql<number>`count(*)::int` })
      .from(member)
      .groupBy(member.teamId),
    getConnections(),
  ]);

  const countByTeam = new Map(countRows.map((r) => [r.teamId, r.count]));
  const teams: TeamRow[] = teamRows.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    workspaceRootPath: t.workspaceRootPath,
    gitTokenSet: t.gitTokenRef !== null,
    memberCount: countByTeam.get(t.id) ?? 0,
  }));

  return (
    <PageFrame title="Org settings" subnav={<SettingsTabs active="org" />} width="full">
      <div className="flex flex-col gap-4">
        <TeamsPanel initialTeams={teams} />

        <Card>
          <CardContent className="flex flex-col items-start gap-2">
            <div className="flex items-center gap-2">
              <Plug className="size-4 text-ink-soft" aria-hidden />
              <Title>MMA connection</Title>
            </div>
            <Text>
              Base URL <Mono>{conn.mmaBaseUrl ?? 'http://127.0.0.1:7337 (default)'}</Mono>. The engine and provider
              models are shared by every team.
            </Text>
            <Link href="/settings/connections" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Configure connection &amp; models
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col items-start gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="size-4 text-ink-soft" aria-hidden />
              <Title>Global usage</Title>
            </div>
            <Text>Org-wide cost, tokens, failure rate, and a per-team breakdown — numbers only, no team contents.</Text>
            <Link href="/usage" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Open usage dashboard
            </Link>
          </CardContent>
        </Card>
      </div>
    </PageFrame>
  );
}
