import { DollarSign, TrendingUp, Cpu, Users, AlertTriangle, UserRound } from 'lucide-react';
import { MetricRow, MetricCard } from '@/components/ui/metric-card';
import {
  Card,
  CardContent,
  Title,
  Text,
  Badge,
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
import { Sparkline } from './Sparkline';

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
    <div className="flex flex-col gap-4">
      <MetricRow>
        <MetricCard
          label="Spent"
          value={formatCost(h.totalCostUsd)}
          sublabel={`${h.dispatchCount} dispatch${h.dispatchCount === 1 ? '' : 'es'}`}
          icon={<DollarSign />}
          iconTint="accent"
          muted={h.dispatchCount === 0}
        />
        <MetricCard
          label="Saved"
          value={formatCost(h.totalSavedUsd || null)}
          sublabel={formatRoi(h.totalSavedUsd, h.totalCostUsd)}
          icon={<TrendingUp />}
          iconTint="sage"
          muted={!h.totalSavedUsd}
        />
        <MetricCard
          label="Tokens"
          value={formatTokens(h.totalTokens)}
          sublabel="input + output"
          icon={<Cpu />}
          iconTint="steel"
          muted={h.totalTokens === 0}
        />
        <MetricCard
          label="Active teams"
          value={h.activeTeams}
          sublabel="billing this period"
          icon={<Users />}
          iconTint="accent"
          muted={h.activeTeams === 0}
        />
        <MetricCard
          label="Failure rate"
          value={pct(h.failureRate)}
          sublabel="of dispatches"
          icon={<AlertTriangle />}
          iconTint="rose"
          muted={h.failureRate === 0}
        />
        <MetricCard
          label="Cost / member"
          value={formatCost(h.costPerMemberUsd || null)}
          sublabel="across all teams"
          icon={<UserRound />}
          iconTint="steel"
          muted={!h.costPerMemberUsd}
        />
      </MetricRow>

      <OrgTrendCard trend={data.trend.orgTotal} />
      <OrgTeamTable rows={data.costByTeam} />
      <OrgInfraTable rows={data.infraBreakdown} />

      <Text className="px-1 text-xs text-ink-faint">
        Numbers only — cost, tokens, and activity aggregated across every team. Project names, specs, journals, and
        member identities stay private to each team.
      </Text>
    </div>
  );
}

function OrgTrendCard({ trend }: { trend: OrgOverviewResult['trend']['orgTotal'] }) {
  return (
    <Card>
      <CardContent>
        <Title as="h2" className="mb-3">Cost trend</Title>
        {trend.length < 2 ? (
          <EmptyState icon={<TrendingUp />} title="Not enough history yet" description="Daily org cost appears here once there are at least two days of activity." />
        ) : (
          <div className="flex flex-col gap-2">
            <Sparkline points={trend.map((p) => p.costUsd)} label="Daily org cost" />
            <div className="flex justify-between text-xs text-ink-soft tabular-nums">
              <span>{trend[0]?.date}</span>
              <span>{trend[trend.length - 1]?.date}</span>
            </div>
          </div>
        )}
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
        <Title as="h2" className="mb-3">Infrastructure breakdown</Title>
        {rows.length === 0 ? (
          <EmptyState icon={<Cpu />} title="No infrastructure usage yet" description="Cost by route, tier, and model appears here once agents run." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Route</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Implementer</TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.route}-${r.tier ?? ''}-${r.implementerModel ?? ''}-${r.reviewerModel ?? ''}-${i}`}>
                    <TableCell className="font-medium">{r.route}</TableCell>
                    <TableCell>{r.tier ? <Badge variant="neutral" size="sm">{r.tier}</Badge> : '—'}</TableCell>
                    <TableCell className="text-ink-soft">{r.implementerModel ?? '—'}</TableCell>
                    <TableCell className="text-ink-soft">{r.reviewerModel ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.callCount}</TableCell>
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
