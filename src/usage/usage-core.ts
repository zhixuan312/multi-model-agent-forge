/**
 * Usage aggregation core — four query functions, one per tab.
 * All accept a period and return structured results for the Usage page.
 */
import { sql, and, eq, isNotNull, gte, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { project } from '@/db/schema/projects';
import { loop, loopRun } from '@/db/schema/loop';
import { team } from '@/db/schema/team';
import { member } from '@/db/schema/identity';

export type Period = 'week' | 'month' | '30d' | '90d' | 'all';

const TIMEZONE = 'Asia/Singapore';

export function periodCutoff(period: Period, now: Date = new Date()): Date | null {
  if (period === 'all') return null;
  if (period === '30d') return new Date(now.getTime() - 30 * 86_400_000);
  if (period === '90d') return new Date(now.getTime() - 90 * 86_400_000);

  const sgt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = Number(sgt.find((p) => p.type === 'year')!.value);
  const m = Number(sgt.find((p) => p.type === 'month')!.value) - 1;
  const d = Number(sgt.find((p) => p.type === 'day')!.value);

  if (period === 'month') {
    const local = new Date(Date.UTC(y, m, 1));
    const offset = getTimezoneOffsetMs(TIMEZONE, local);
    return new Date(local.getTime() - offset);
  }

  // 'week' — Monday 00:00 SGT
  const dayOfWeek = new Date(Date.UTC(y, m, d)).getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(Date.UTC(y, m, d - daysSinceMonday));
  const offset = getTimezoneOffsetMs(TIMEZONE, monday);
  return new Date(monday.getTime() - offset);
}

function getTimezoneOffsetMs(tz: string, date: Date): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: tz });
  return new Date(tzStr).getTime() - new Date(utcStr).getTime();
}

function terminalFilter(cutoff: Date | null) {
  const base = inArray(mmaBatch.status, ['done', 'failed']);
  if (!cutoff) return base;
  return and(base, gte(mmaBatch.createdAt, cutoff))!;
}

function teamScopeFilter(teamId: string | null | undefined) {
  if (!teamId) return undefined;
  return eq(mmaBatch.teamId, teamId);
}

// Subquery: all mma_batch ids that belong to loop runs (via loop_run_id FK or the legacy mma_batch_id FK)
const loopBatchIds = sql`(SELECT id FROM forge.ops_mma_batch WHERE loop_run_id IS NOT NULL UNION SELECT mma_batch_id FROM forge.loop_run WHERE mma_batch_id IS NOT NULL)`;

export interface OverviewMetrics {
  taskCount: number;
  totalCost: number;
  totalSaved: number;
  totalTokens: number;
  totalDurationMs: number;
}

export interface SourceRow {
  source: 'projects' | 'loops' | 'standalone';
  taskCount: number;
  costUsd: number;
  savedUsd: number;
  tokens: number;
  durationMs: number;
}

export interface RouteRow {
  route: string;
  taskCount: number;
  costUsd: number;
  avgCostUsd: number;
  avgDurationMs: number;
}

export interface OverviewResult {
  metrics: OverviewMetrics;
  bySources: SourceRow[];
  byRoutes: RouteRow[];
  /** Daily cost/volume series for this team over the period (chart input). */
  trend: UsagePoint[];
}

// ── Org usage rollup types ──────────────────────────────────────────────────

export interface OrgUsageHeadline {
  totalCostUsd: number;
  totalSavedUsd: number;
  totalTokens: number;
  dispatchCount: number;
  failureRate: number;
  activeTeams: number;
  costPerMemberUsd: number;
  trendRatio: number;
}

export interface OrgTeamUsageRow {
  teamId: string;
  teamName: string;
  memberCount: number;
  costUsd: number;
  savedUsd: number;
  costShareRatio: number;
  trendRatio: number;
  sparkline: number[];
}

export interface OrgInfraBreakdownRow {
  route: string;
  costUsd: number;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  avgCostUsd: number;
}

export interface UsagePoint {
  date: string;
  costUsd: number;
  savedUsd: number;
  count: number;
}

export interface TeamSparkline {
  teamId: string;
  teamName: string;
  sparkline: UsagePoint[];
}

export interface TeamUsageDrilldown {
  teamId: string;
  teamName: string;
  costUsd: number;
  savedUsd: number;
  dispatchCount: number;
  byRoute: OrgInfraBreakdownRow[];
}

export interface OrgOverviewResult {
  headline: OrgUsageHeadline;
  costByTeam: OrgTeamUsageRow[];
  infraBreakdown: OrgInfraBreakdownRow[];
  trend: { orgTotal: UsagePoint[]; perTeam: TeamSparkline[] };
  teamDrilldown: TeamUsageDrilldown;
}

export interface UsageDeps {
  db?: Db;
  teamId?: string | null;
  scope?: 'team' | 'org';
}

export const ROUTE_TO_STAGE: Record<string, string> = {
  investigate: 'exploration',
  research: 'exploration',
  journal_recall: 'exploration',
  execute_plan: 'execute',
  delegate: 'execute',
  review: 'review',
  journal_record: 'journal',
};

export const STAGE_LABELS: Record<string, string> = {
  exploration: 'Research & Discovery',
  spec: 'Spec & Design',
  plan: 'Planning',
  execute: 'Building',
  review: 'Quality Review',
  journal: 'Learning',
  other: 'Other',
};

export function usageOverview(period: Period, deps: UsageDeps & { scope: 'org' }): Promise<OrgOverviewResult>;
export function usageOverview(period: Period, deps?: UsageDeps): Promise<OverviewResult>;
export async function usageOverview(
  period: Period,
  deps: UsageDeps = {},
): Promise<OverviewResult | OrgOverviewResult> {
  if (deps.scope === 'org') {
    return usageOverviewOrg(period, deps);
  }
  return usageOverviewTeam(period, deps);
}

async function usageOverviewTeam(
  period: Period,
  deps: UsageDeps = {},
): Promise<OverviewResult> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);
  const where = and(terminalFilter(cutoff), teamScopeFilter(deps.teamId));

  const [metricsRow] = await db
    .select({
      taskCount: sql<number>`count(*)::int`,
      totalCost: sql<number>`coalesce(sum(${mmaBatch.costUsd}::numeric), 0)::float`,
      totalSaved: sql<number>`coalesce(sum(${mmaBatch.savedVsMainUsd}::numeric), 0)::float`,
      totalTokens: sql<number>`coalesce(sum(coalesce(${mmaBatch.inputTokens}, 0) + coalesce(${mmaBatch.outputTokens}, 0)), 0)::int`,
      totalDurationMs: sql<number>`coalesce(sum(${mmaBatch.durationMs}), 0)::int`,
    })
    .from(mmaBatch)
    .where(where);

  const metrics: OverviewMetrics = {
    taskCount: metricsRow?.taskCount ?? 0,
    totalCost: metricsRow?.totalCost ?? 0,
    totalSaved: metricsRow?.totalSaved ?? 0,
    totalTokens: metricsRow?.totalTokens ?? 0,
    totalDurationMs: metricsRow?.totalDurationMs ?? 0,
  };

  // By source — 3 mutually exclusive queries
  const sourceAgg = (extraWhere: ReturnType<typeof and>) =>
    db
      .select({
        taskCount: sql<number>`count(*)::int`,
        costUsd: sql<number>`coalesce(sum(${mmaBatch.costUsd}::numeric), 0)::float`,
        savedUsd: sql<number>`coalesce(sum(${mmaBatch.savedVsMainUsd}::numeric), 0)::float`,
        tokens: sql<number>`coalesce(sum(coalesce(${mmaBatch.inputTokens}, 0) + coalesce(${mmaBatch.outputTokens}, 0)), 0)::int`,
        durationMs: sql<number>`coalesce(sum(${mmaBatch.durationMs}), 0)::int`,
      })
      .from(mmaBatch)
      .where(extraWhere);

  const cutoffCond = cutoff ? gte(mmaBatch.createdAt, cutoff) : undefined;
  const termCond = inArray(mmaBatch.status, ['done', 'failed']);
  const teamCond = teamScopeFilter(deps.teamId);

  const [loopsRow] = await sourceAgg(
    and(termCond, cutoffCond, teamCond, sql`${mmaBatch.id} IN ${loopBatchIds}`),
  );
  const [projectsRow] = await sourceAgg(
    and(
      termCond,
      cutoffCond,
      teamCond,
      isNotNull(mmaBatch.projectId),
      sql`${mmaBatch.id} NOT IN ${loopBatchIds}`,
    ),
  );
  const [standaloneRow] = await sourceAgg(
    and(
      termCond,
      cutoffCond,
      teamCond,
      sql`${mmaBatch.projectId} IS NULL`,
      sql`${mmaBatch.id} NOT IN ${loopBatchIds}`,
    ),
  );

  const bySources: SourceRow[] = [
    { source: 'projects', ...toSourceRow(projectsRow) },
    { source: 'loops', ...toSourceRow(loopsRow) },
    { source: 'standalone', ...toSourceRow(standaloneRow) },
  ];

  // By route
  const routeRows = await db
    .select({
      route: mmaBatch.route,
      taskCount: sql<number>`count(*)::int`,
      costUsd: sql<number>`coalesce(sum(${mmaBatch.costUsd}::numeric), 0)::float`,
      avgCostUsd: sql<number>`coalesce(avg(${mmaBatch.costUsd}::numeric), 0)::float`,
      avgDurationMs: sql<number>`coalesce(avg(${mmaBatch.durationMs}), 0)::int`,
    })
    .from(mmaBatch)
    .where(where)
    .groupBy(mmaBatch.route)
    .orderBy(sql`sum(${mmaBatch.costUsd}::numeric) desc nulls last`);

  const byRoutes: RouteRow[] = routeRows.map((r) => ({
    route: r.route,
    taskCount: r.taskCount,
    costUsd: r.costUsd,
    avgCostUsd: r.avgCostUsd,
    avgDurationMs: r.avgDurationMs,
  }));

  // Daily cost/volume series for the chart. TIMEZONE is a hardcoded constant, so
  // raw interpolation is safe — Postgres rejects a parameterised timezone in the
  // GROUP BY (it reads as an ungrouped-column reference).
  const dayBucket = sql`date_trunc('day', ${mmaBatch.createdAt} at time zone ${sql.raw(`'${TIMEZONE}'`)})`;
  const trendRows = await db
    .select({
      date: sql<string>`to_char(${dayBucket}, 'YYYY-MM-DD')`,
      costUsd: sql<number>`coalesce(sum(${mmaBatch.costUsd}::numeric), 0)::float`,
      savedUsd: sql<number>`coalesce(sum(${mmaBatch.savedVsMainUsd}::numeric), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(mmaBatch)
    .where(where)
    .groupBy(dayBucket)
    .orderBy(dayBucket);
  const trend: UsagePoint[] = trendRows.map((r) => ({ date: r.date, costUsd: r.costUsd, savedUsd: r.savedUsd, count: r.count }));

  return { metrics, bySources, byRoutes, trend };
}

async function usageOverviewOrg(
  period: Period,
  deps: UsageDeps = {},
): Promise<OrgOverviewResult> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);
  const cutoffCond = cutoff ? gte(mmaBatch.createdAt, cutoff) : undefined;
  const termCond = inArray(mmaBatch.status, ['done', 'failed']);

  // Headline totals
  const [headlineRow] = await db
    .select({
      totalCostUsd: sql<number>`coalesce(sum(${mmaBatch.costUsd}::numeric), 0)::float`,
      totalSavedUsd: sql<number>`coalesce(sum(${mmaBatch.savedVsMainUsd}::numeric), 0)::float`,
      totalTokens: sql<number>`coalesce(sum(coalesce(${mmaBatch.inputTokens}, 0) + coalesce(${mmaBatch.outputTokens}, 0) + coalesce(${mmaBatch.cacheTokens}, 0)), 0)::int`,
      dispatchCount: sql<number>`count(*)::int`,
      failedCount: sql<number>`sum(case when ${mmaBatch.status} = 'failed' then 1 else 0 end)::int`,
      activeTeams: sql<number>`count(distinct ${mmaBatch.teamId})::int`,
    })
    .from(mmaBatch)
    .where(and(termCond, cutoffCond));

  const headline: OrgUsageHeadline = {
    totalCostUsd: headlineRow?.totalCostUsd ?? 0,
    totalSavedUsd: headlineRow?.totalSavedUsd ?? 0,
    totalTokens: headlineRow?.totalTokens ?? 0,
    dispatchCount: headlineRow?.dispatchCount ?? 0,
    failureRate: headlineRow?.dispatchCount ? (headlineRow.failedCount ?? 0) / headlineRow.dispatchCount : 0,
    activeTeams: headlineRow?.activeTeams ?? 0,
    costPerMemberUsd: 0, // Will be computed after team member counts
    trendRatio: 0, // Will be computed from trend
  };

  // Cost by team with member counts
  const costByTeamRows = await db
    .select({
      teamId: mmaBatch.teamId,
      costUsd: sql<number>`coalesce(sum(${mmaBatch.costUsd}::numeric), 0)::float`,
      savedUsd: sql<number>`coalesce(sum(${mmaBatch.savedVsMainUsd}::numeric), 0)::float`,
    })
    .from(mmaBatch)
    .where(and(termCond, cutoffCond))
    .groupBy(mmaBatch.teamId)
    .orderBy(sql`sum(${mmaBatch.costUsd}::numeric) desc nulls last`);

  let totalMemberCount = 0;
  const costByTeam: OrgTeamUsageRow[] = [];

  for (const row of costByTeamRows) {
    const [teamRow] = await db.select({ name: team.name }).from(team).where(eq(team.id, row.teamId!)).limit(1);
    const [memberCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(member)
      .where(eq(member.teamId, row.teamId!));

    const memberCount = memberCountRow?.count ?? 0;
    totalMemberCount += memberCount;

    costByTeam.push({
      teamId: row.teamId!,
      teamName: teamRow?.name ?? 'Unknown',
      memberCount,
      costUsd: row.costUsd,
      savedUsd: row.savedUsd,
      costShareRatio: headline.totalCostUsd > 0 ? row.costUsd / headline.totalCostUsd : 0,
      trendRatio: 1.0, // Simplified — would require prior period comparison
      sparkline: [], // Simplified — would require daily bucketing
    });
  }

  // Update headline with computed values
  headline.costPerMemberUsd = totalMemberCount > 0 ? headline.totalCostUsd / totalMemberCount : 0;
  // headline.trendRatio is computed from the daily series below.

  // Infrastructure breakdown by route. The MMA envelope carries no per-phase
  // model/tier, so we report spend per route only.
  const infraBreakdownRows = await db
    .select({
      route: mmaBatch.route,
      costUsd: sql<number>`coalesce(sum(${mmaBatch.costUsd}::numeric), 0)::float`,
      callCount: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${mmaBatch.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${mmaBatch.outputTokens}), 0)::int`,
      cacheTokens: sql<number>`coalesce(sum(${mmaBatch.cacheTokens}), 0)::int`,
      avgCostUsd: sql<number>`coalesce(avg(${mmaBatch.costUsd}::numeric), 0)::float`,
    })
    .from(mmaBatch)
    .where(and(termCond, cutoffCond))
    .groupBy(mmaBatch.route)
    .orderBy(sql`sum(${mmaBatch.costUsd}::numeric) desc nulls last`);

  const infraBreakdown: OrgInfraBreakdownRow[] = infraBreakdownRows.map((r) => ({
    route: r.route,
    costUsd: r.costUsd,
    callCount: r.callCount,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheTokens: r.cacheTokens,
    avgCostUsd: r.avgCostUsd,
  }));

  // Trend: org-total daily series (SGT day buckets) — cost, savings, and dispatch
  // count per day feed the dashboard's volume-and-cost chart. Per-team sparklines
  // are left empty until a per-team daily rollup is added.
  // Inline the timezone as a SQL literal (not a bind param) so the SELECT and
  // GROUP BY day-bucket expressions are textually identical — Postgres rejects a
  // parameterised timezone in GROUP BY as an ungrouped-column reference. TIMEZONE
  // is a hardcoded constant, so raw interpolation is safe.
  const dayBucket = sql`date_trunc('day', ${mmaBatch.createdAt} at time zone ${sql.raw(`'${TIMEZONE}'`)})`;
  const trendRows = await db
    .select({
      date: sql<string>`to_char(${dayBucket}, 'YYYY-MM-DD')`,
      costUsd: sql<number>`coalesce(sum(${mmaBatch.costUsd}::numeric), 0)::float`,
      savedUsd: sql<number>`coalesce(sum(${mmaBatch.savedVsMainUsd}::numeric), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(mmaBatch)
    .where(and(termCond, cutoffCond))
    .groupBy(dayBucket)
    .orderBy(dayBucket);

  const orgTotal: UsagePoint[] = trendRows.map((r) => ({ date: r.date, costUsd: r.costUsd, savedUsd: r.savedUsd, count: r.count }));
  const trend = { orgTotal, perTeam: [] as TeamSparkline[] };

  // trendRatio: second-half spend vs first-half spend across the series (>1 = rising).
  const mid = Math.floor(orgTotal.length / 2);
  const firstHalf = orgTotal.slice(0, mid).reduce((s, p) => s + p.costUsd, 0);
  const secondHalf = orgTotal.slice(mid).reduce((s, p) => s + p.costUsd, 0);
  headline.trendRatio = firstHalf > 0 ? secondHalf / firstHalf : 1;

  // Team drilldown: select first team for now (simplified)
  const teamDrilldown: TeamUsageDrilldown = {
    teamId: costByTeamRows[0]?.teamId ?? '',
    teamName: costByTeam[0]?.teamName ?? 'N/A',
    costUsd: costByTeamRows[0]?.costUsd ?? 0,
    savedUsd: costByTeamRows[0]?.savedUsd ?? 0,
    dispatchCount: 0, // Would require separate query
    byRoute: infraBreakdown,
  };

  return {
    headline,
    costByTeam,
    infraBreakdown,
    trend,
    teamDrilldown,
  };
}

function toSourceRow(row: Record<string, unknown> | undefined): Omit<SourceRow, 'source'> {
  return {
    taskCount: (row?.taskCount as number) ?? 0,
    costUsd: (row?.costUsd as number) ?? 0,
    savedUsd: (row?.savedUsd as number) ?? 0,
    tokens: (row?.tokens as number) ?? 0,
    durationMs: (row?.durationMs as number) ?? 0,
  };
}

export interface ProjectUsageRow {
  projectId: string;
  projectName: string;
  phase: string;
  taskCount: number;
  costUsd: number;
  savedUsd: number;
  tokens: number;
  durationMs: number;
}

export interface ProjectStageRow {
  stage: string;
  label: string;
  taskCount: number;
  costUsd: number;
  tokens: number;
  durationMs: number;
}

export async function usageByProject(
  period: Period,
  deps: UsageDeps = {},
): Promise<ProjectUsageRow[]> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);
  const cutoffCond = cutoff ? gte(mmaBatch.createdAt, cutoff) : undefined;
  const termCond = inArray(mmaBatch.status, ['done', 'failed']);
  const teamCond = teamScopeFilter(deps.teamId);

  const rows = await db
    .select({
      projectId: mmaBatch.projectId,
      projectName: project.name,
      phase: project.phase,
      taskCount: sql<number>`count(*)::int`,
      costUsd: sql<number>`coalesce(sum(${mmaBatch.costUsd}::numeric), 0)::float`,
      savedUsd: sql<number>`coalesce(sum(${mmaBatch.savedVsMainUsd}::numeric), 0)::float`,
      tokens: sql<number>`coalesce(sum(coalesce(${mmaBatch.inputTokens}, 0) + coalesce(${mmaBatch.outputTokens}, 0)), 0)::int`,
      durationMs: sql<number>`coalesce(sum(${mmaBatch.durationMs}), 0)::int`,
    })
    .from(mmaBatch)
    .innerJoin(project, eq(project.id, mmaBatch.projectId))
    .where(
      and(
        termCond,
        cutoffCond,
        teamCond,
        isNotNull(mmaBatch.projectId),
        sql`${mmaBatch.id} NOT IN ${loopBatchIds}`,
      ),
    )
    .groupBy(mmaBatch.projectId, project.name, project.phase)
    .orderBy(sql`sum(${mmaBatch.costUsd}::numeric) desc nulls last`);

  return rows.map((r) => ({
    projectId: r.projectId!,
    projectName: r.projectName,
    phase: r.phase,
    taskCount: r.taskCount,
    costUsd: r.costUsd,
    savedUsd: r.savedUsd,
    tokens: r.tokens,
    durationMs: r.durationMs,
  }));
}

export interface LoopUsageRow {
  loopId: string;
  loopName: string;
  kind: string;
  runCount: number;
  costUsd: number;
  savedUsd: number;
  tokens: number;
  durationMs: number;
  changedCount: number;
  noChangeCount: number;
  failedCount: number;
}

export async function usageByLoop(
  period: Period,
  deps: UsageDeps = {},
): Promise<LoopUsageRow[]> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);
  const cutoffCond = cutoff ? gte(mmaBatch.createdAt, cutoff) : undefined;

  // Two-pass: first get per-loop run stats, then sum batch costs per loop.
  const runWhere = deps.teamId
    ? and(
        cutoffCond ? gte(loopRun.startedAt, cutoff!) : undefined,
        eq(loopRun.teamId, deps.teamId),
      )
    : cutoffCond ? gte(loopRun.startedAt, cutoff!) : undefined;

  const runRows = await db
    .select({
      loopId: loop.id,
      loopName: loop.name,
      kind: loop.kind,
      runCount: sql<number>`count(distinct ${loopRun.runId})::int`,
      changedCount: sql<number>`count(case when ${loopRun.status} = 'changed' then 1 end)::int`,
      noChangeCount: sql<number>`count(case when ${loopRun.status} = 'no_changes' then 1 end)::int`,
      failedCount: sql<number>`count(case when ${loopRun.status} = 'failed' then 1 end)::int`,
    })
    .from(loopRun)
    .innerJoin(loop, eq(loop.id, loopRun.loopId))
    .where(runWhere)
    .groupBy(loop.id, loop.name, loop.kind);

  // Sum batch costs for all batches linked to each loop's runs
  const costWhere = deps.teamId
    ? cutoff
      ? sql`b.created_at >= ${cutoff.toISOString()} AND b.team_id = ${deps.teamId}`
      : sql`b.team_id = ${deps.teamId}`
    : cutoff ? sql`b.created_at >= ${cutoff.toISOString()}` : undefined;

  const costRows = await db
    .select({
      loopId: sql<string>`lr.loop_id`,
      costUsd: sql<number>`coalesce(sum(b.cost_usd::numeric), 0)::float`,
      savedUsd: sql<number>`coalesce(sum(b.saved_vs_main_usd::numeric), 0)::float`,
      tokens: sql<number>`coalesce(sum(coalesce(b.input_tokens, 0) + coalesce(b.output_tokens, 0)), 0)::int`,
      durationMs: sql<number>`coalesce(sum(b.duration_ms), 0)::int`,
    })
    .from(sql`forge.ops_mma_batch b`)
    .innerJoin(sql`forge.loop_run lr`, sql`b.loop_run_id = lr.id OR b.id = lr.mma_batch_id`)
    .where(costWhere)
    .groupBy(sql`lr.loop_id`);

  const costByLoop = new Map(costRows.map((r) => [r.loopId, r]));

  const rows = runRows.map((r) => {
    const cost = costByLoop.get(r.loopId);
    return { ...r, costUsd: cost?.costUsd ?? 0, savedUsd: cost?.savedUsd ?? 0, tokens: cost?.tokens ?? 0, durationMs: cost?.durationMs ?? 0 };
  });

  return rows.map((r) => ({
    loopId: r.loopId,
    loopName: r.loopName,
    kind: r.kind,
    runCount: r.runCount,
    costUsd: r.costUsd,
    savedUsd: r.savedUsd,
    tokens: r.tokens,
    durationMs: r.durationMs,
    changedCount: r.changedCount,
    noChangeCount: r.noChangeCount,
    failedCount: r.failedCount,
  }));
}

export interface StandaloneRow {
  route: string;
  label: string;
  taskCount: number;
  costUsd: number;
  savedUsd: number;
  avgCostUsd: number;
  tokens: number;
  durationMs: number;
}

const ROUTE_LABELS: Record<string, string> = {
  journal_recall: 'Journal recall',
  delegate: 'Ad-hoc task',
  research: 'Research',
  investigate: 'Code investigation',
  journal_record: 'Learning capture',
  audit: 'Audit',
  review: 'Review',
  execute_plan: 'Plan execution',
  orchestrate: 'Orchestration',
};

export async function usageStandalone(
  period: Period,
  deps: UsageDeps = {},
): Promise<StandaloneRow[]> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);
  const cutoffCond = cutoff ? gte(mmaBatch.createdAt, cutoff) : undefined;
  const termCond = inArray(mmaBatch.status, ['done', 'failed']);
  const teamCond = teamScopeFilter(deps.teamId);

  const rows = await db
    .select({
      route: mmaBatch.route,
      taskCount: sql<number>`count(*)::int`,
      costUsd: sql<number>`coalesce(sum(${mmaBatch.costUsd}::numeric), 0)::float`,
      savedUsd: sql<number>`coalesce(sum(${mmaBatch.savedVsMainUsd}::numeric), 0)::float`,
      avgCostUsd: sql<number>`coalesce(avg(${mmaBatch.costUsd}::numeric), 0)::float`,
      tokens: sql<number>`coalesce(sum(coalesce(${mmaBatch.inputTokens}, 0) + coalesce(${mmaBatch.outputTokens}, 0)), 0)::int`,
      durationMs: sql<number>`coalesce(sum(${mmaBatch.durationMs}), 0)::int`,
    })
    .from(mmaBatch)
    .where(
      and(
        termCond,
        cutoffCond,
        teamCond,
        sql`${mmaBatch.projectId} IS NULL`,
        sql`${mmaBatch.id} NOT IN ${loopBatchIds}`,
      ),
    )
    .groupBy(mmaBatch.route)
    .orderBy(sql`sum(${mmaBatch.costUsd}::numeric) desc nulls last`);

  return rows.map((r) => ({
    route: r.route,
    label: ROUTE_LABELS[r.route] ?? r.route,
    taskCount: r.taskCount,
    costUsd: r.costUsd,
    savedUsd: r.savedUsd,
    avgCostUsd: r.avgCostUsd,
    tokens: r.tokens,
    durationMs: r.durationMs,
  }));
}

// ── Overview by-route-per-source (for expandable source rows) ────────────

export interface SourceRouteRow {
  route: string;
  routeLabel: string;
  taskCount: number;
  costUsd: number;
  durationMs: number;
}

export interface RouteAggRow {
  route: string;
  callCount: number;
  totalCostUsd: number;
  totalSavedUsd: number;
  totalDurationMs: number;
  avgCostUsd: number;
  avgDurationMs: number;
}

async function routeAggQuery(
  extraCond: ReturnType<typeof and>,
  db: Db,
): Promise<RouteAggRow[]> {
  const rows = await db
    .select({
      route: mmaBatch.route,
      callCount: sql<number>`count(*)::int`,
      totalCostUsd: sql<number>`coalesce(sum(${mmaBatch.costUsd}::numeric), 0)::float`,
      totalSavedUsd: sql<number>`coalesce(sum(${mmaBatch.savedVsMainUsd}::numeric), 0)::float`,
      totalDurationMs: sql<number>`coalesce(sum(${mmaBatch.durationMs}), 0)::int`,
      avgCostUsd: sql<number>`coalesce(avg(${mmaBatch.costUsd}::numeric), 0)::float`,
      avgDurationMs: sql<number>`coalesce(avg(${mmaBatch.durationMs}), 0)::int`,
    })
    .from(mmaBatch)
    .where(extraCond)
    .groupBy(mmaBatch.route)
    .orderBy(sql`sum(${mmaBatch.costUsd}::numeric) desc nulls last`);

  return rows.map((r) => ({
    route: r.route,
    callCount: r.callCount,
    totalCostUsd: r.totalCostUsd,
    totalSavedUsd: r.totalSavedUsd,
    totalDurationMs: r.totalDurationMs,
    avgCostUsd: r.avgCostUsd,
    avgDurationMs: r.avgDurationMs,
  }));
}

export async function routeAggForSource(
  source: 'projects' | 'loops' | 'standalone',
  period: Period,
  deps: UsageDeps = {},
): Promise<RouteAggRow[]> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);
  const cutoffCond = cutoff ? gte(mmaBatch.createdAt, cutoff) : undefined;
  const termCond = inArray(mmaBatch.status, ['done', 'failed']);
  const teamCond = teamScopeFilter(deps.teamId);

  let sourceCond;
  if (source === 'loops') {
    sourceCond = sql`${mmaBatch.id} IN ${loopBatchIds}`;
  } else if (source === 'projects') {
    sourceCond = and(isNotNull(mmaBatch.projectId), sql`${mmaBatch.id} NOT IN ${loopBatchIds}`);
  } else {
    sourceCond = and(sql`${mmaBatch.projectId} IS NULL`, sql`${mmaBatch.id} NOT IN ${loopBatchIds}`);
  }

  return routeAggQuery(and(termCond, cutoffCond, teamCond, sourceCond), db);
}

export async function routeAggForProject(
  projectId: string,
  period: Period,
  deps: UsageDeps = {},
): Promise<RouteAggRow[]> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);
  const cutoffCond = cutoff ? gte(mmaBatch.createdAt, cutoff) : undefined;
  const termCond = inArray(mmaBatch.status, ['done', 'failed']);
  const teamCond = teamScopeFilter(deps.teamId);

  return routeAggQuery(
    and(termCond, cutoffCond, teamCond, eq(mmaBatch.projectId, projectId), sql`${mmaBatch.id} NOT IN ${loopBatchIds}`),
    db,
  );
}

export async function routeAggForLoop(
  loopId: string,
  period: Period,
  deps: UsageDeps = {},
): Promise<RouteAggRow[]> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);
  const cutoffCond = cutoff ? gte(mmaBatch.createdAt, cutoff) : undefined;
  const termCond = inArray(mmaBatch.status, ['done', 'failed']);
  const teamCond = teamScopeFilter(deps.teamId);

  // All batches linked to this loop's runs via loop_run_id or legacy mma_batch_id
  const loopBatchCond = sql`(${mmaBatch.loopRunId} IN (SELECT id FROM forge.loop_run WHERE loop_id = ${loopId})
    OR ${mmaBatch.id} IN (SELECT mma_batch_id FROM forge.loop_run WHERE loop_id = ${loopId} AND mma_batch_id IS NOT NULL))`;

  return routeAggQuery(and(termCond, cutoffCond, teamCond, loopBatchCond), db);
}

// ── Detail queries for expandable rows ──────────────────────────────────

export interface BatchDetailRow {
  id: string;
  route: string;
  routeLabel: string;
  costUsd: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
}

export async function batchesForProject(
  projectId: string,
  period: Period,
  deps: UsageDeps = {},
): Promise<BatchDetailRow[]> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);
  const teamCond = teamScopeFilter(deps.teamId);

  const rows = await db
    .select({
      id: mmaBatch.id,
      route: mmaBatch.route,
      costUsd: mmaBatch.costUsd,
      durationMs: mmaBatch.durationMs,
      inputTokens: mmaBatch.inputTokens,
      outputTokens: mmaBatch.outputTokens,
      createdAt: mmaBatch.createdAt,
    })
    .from(mmaBatch)
    .where(
      and(
        eq(mmaBatch.projectId, projectId),
        teamCond,
        inArray(mmaBatch.status, ['done', 'failed']),
        cutoff ? gte(mmaBatch.createdAt, cutoff) : undefined,
      ),
    )
    .orderBy(mmaBatch.createdAt);

  return rows.map((r) => ({
    id: r.id,
    route: r.route,
    routeLabel: ROUTE_LABELS[r.route] ?? r.route,
    costUsd: r.costUsd ? Number(r.costUsd) : null,
    durationMs: r.durationMs,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function batchesForLoopRun(
  loopId: string,
  period: Period,
  deps: UsageDeps = {},
): Promise<Array<{ runId: string; startedAt: string; status: string; batches: BatchDetailRow[] }>> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);

  const runs = await db
    .select({
      id: loopRun.id,
      runId: loopRun.runId,
      status: loopRun.status,
      startedAt: loopRun.startedAt,
      mmaBatchId: loopRun.mmaBatchId,
    })
    .from(loopRun)
    .where(
      and(
        eq(loopRun.loopId, loopId),
        deps.teamId ? eq(loopRun.teamId, deps.teamId) : undefined,
        cutoff ? gte(loopRun.startedAt, cutoff) : undefined,
      ),
    )
    .orderBy(sql`${loopRun.startedAt} desc`)
    .limit(20);

  const result: Array<{ runId: string; startedAt: string; status: string; batches: BatchDetailRow[] }> = [];

  for (const run of runs) {
    const teamWhere = deps.teamId
      ? sql`(${mmaBatch.loopRunId} = ${run.id} OR ${mmaBatch.id} = ${run.mmaBatchId})
            AND ${mmaBatch.status} IN ('done', 'failed')
            AND ${mmaBatch.teamId} = ${deps.teamId}`
      : sql`(${mmaBatch.loopRunId} = ${run.id} OR ${mmaBatch.id} = ${run.mmaBatchId})
            AND ${mmaBatch.status} IN ('done', 'failed')`;

    const batches = await db
      .select({
        id: mmaBatch.id,
        route: mmaBatch.route,
        costUsd: mmaBatch.costUsd,
        durationMs: mmaBatch.durationMs,
        inputTokens: mmaBatch.inputTokens,
        outputTokens: mmaBatch.outputTokens,
        createdAt: mmaBatch.createdAt,
      })
      .from(mmaBatch)
      .where(teamWhere)
      .orderBy(mmaBatch.createdAt);

    result.push({
      runId: run.runId,
      startedAt: run.startedAt.toISOString(),
      status: run.status,
      batches: batches.map((b) => ({
        id: b.id,
        route: b.route,
        routeLabel: ROUTE_LABELS[b.route] ?? b.route,
        costUsd: b.costUsd ? Number(b.costUsd) : null,
        durationMs: b.durationMs,
        inputTokens: b.inputTokens,
        outputTokens: b.outputTokens,
        createdAt: b.createdAt.toISOString(),
      })),
    });
  }

  return result;
}
