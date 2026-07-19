import { DollarSign, TrendingUp, Cpu, Users, AlertTriangle, UserRound } from 'lucide-react';
import { StageShell } from '@/components/patterns/stage-shell';
import {
  Card,
  CardContent,
  Title,
  EmptyState,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';
import { formatCost, formatTokens, formatRoi } from '@/usage/format';
import type { OrgOverviewResult } from '@/usage/usage-core';
import { CostTrendChart } from './CostTrendChart';

/**
 * Org-level global usage view (Spec 3, org_admin only). Numbers-only rollup
 * across every team — the org owner sees the bill and where it goes, never any
 * team's project/spec/journal contents or member identities. Laid out as one
 * scrollable column: a headline metric row, then the daily cost trend, per-team
 * spend, and the infrastructure breakdown, closed by the privacy note.
 */

const pct = (r: number): string => `${(r * 100).toFixed(r > 0 && r < 0.1 ? 1 : 0)}%`;

export function OrgUsageDashboard({ data }: { data: OrgOverviewResult }) {
  const h = data.headline;
  return (
    <StageShell
      scroll="outer"
      metrics={[
        { label: 'Spent', value: formatCost(h.totalCostUsd), sublabel: `${h.dispatchCount} dispatch${h.dispatchCount === 1 ? '' : 'es'}`, icon: <DollarSign />, iconTint: 'accent', muted: h.dispatchCount === 0 },
        { label: 'Saved', value: formatCost(h.totalSavedUsd || null), sublabel: formatRoi(h.totalSavedUsd, h.totalCostUsd), icon: <TrendingUp />, iconTint: 'sage', muted: !h.totalSavedUsd },
        { label: 'Tokens', value: formatTokens(h.totalTokens), sublabel: 'input · output · cache', icon: <Cpu />, iconTint: 'steel', muted: h.totalTokens === 0 },
        { label: 'Active teams', value: h.activeTeams, sublabel: 'billing this period', icon: <Users />, iconTint: 'accent', muted: h.activeTeams === 0 },
        { label: 'Failure rate', value: pct(h.failureRate), sublabel: 'of dispatches', icon: <AlertTriangle />, iconTint: 'rose', muted: h.failureRate === 0 },
        { label: 'Cost / member', value: formatCost(h.costPerMemberUsd || null), sublabel: 'across all teams', icon: <UserRound />, iconTint: 'steel', muted: !h.costPerMemberUsd },
      ]}
    >
        <div className="flex flex-col gap-4">
          <OrgTrendCard trend={data.trend.orgTotal} />
          <OrgTeamTable rows={data.costByTeam} />
          <OrgInfraTable rows={data.infraBreakdown} />
        </div>
    </StageShell>
  );
}

function OrgTrendCard({ trend }: { trend: OrgOverviewResult['trend']['orgTotal'] }) {
  return (
    <Card>
      <CardContent>
        <Title as="h2" className="mb-3">Cost &amp; volume</Title>
        <CostTrendChart points={trend} />
      </CardContent>
    </Card>
  );
}

function OrgTeamTable({ rows }: { rows: OrgOverviewResult['costByTeam'] }) {
  return (
    <Card>
      <CardContent>
        <Title as="h2" className="mb-3">Cost by team</Title>
        {rows.length === 0 ? (
          <EmptyState icon={<Users />} title="No team usage yet" description="Per-team spend appears here once agents run." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Saved</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.teamId}>
                    <TableCell className="font-medium">{t.teamName}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.memberCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCost(t.costUsd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCost(t.savedUsd || null)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(t.costShareRatio)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OrgInfraTable({ rows }: { rows: OrgOverviewResult['infraBreakdown'] }) {
  return (
    <Card>
      <CardContent>
        <Title as="h2" className="mb-3">Usage breakdown</Title>
        {rows.length === 0 ? (
          <EmptyState icon={<Cpu />} title="No usage yet" description="Cost, tokens, and calls by route appear here once agents run." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Route</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Cache</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.route}>
                    <TableCell className="font-medium">{r.route}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.callCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(r.inputTokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(r.outputTokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(r.cacheTokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCost(r.costUsd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCost(r.avgCostUsd || null)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
