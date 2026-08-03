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

import type { Period } from '@/usage/period';
import type { UsageSource } from '@/usage/source';
import { DISPLAY_TIMEZONE } from '@/lib/format-date';
import { TERMINAL_MMA_STATUS } from '@/db/enums';

/**
 * The zone the reporting periods are cut in — "this week" means Monday 00:00 in the
 * product's timezone, and the daily chart buckets must agree with the dates shown beside
 * them. This was a fourth hardcoded `'Asia/Singapore'`: `format-date` exports
 * `DISPLAY_TIMEZONE` precisely so `LOOP_TIMEZONE` can be pinned to it, and this copy sat
 * outside that ratchet — change the product's zone and the usage boundaries would quietly
 * keep the old one.
 */
const TIMEZONE = DISPLAY_TIMEZONE;

/**
 * The start of a reporting period, or null for 'all'. Exported for its own test — the
 * calendar arithmetic (Monday 00:00, month start, DST-free offset) is the part worth
 * pinning, and every query below goes through it.
 */
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

/**
 * Second-half vs first-half spend across a daily series (>1 = rising, 1 = flat/insufficient data).
 * SYMMETRIC split: take `mid` days from each end and drop the middle day on an odd-length series.
 * The old `slice(mid)` gave the second half an extra day, so even flat spend read as "rising"
 * (3 equal days → 1 vs 2 days → ratio 2.0).
 */
export function trendRatio(dailyCosts: number[]): number {
  const mid = Math.floor(dailyCosts.length / 2);
  const first = dailyCosts.slice(0, mid).reduce((s, c) => s + c, 0);
  const second = dailyCosts.slice(dailyCosts.length - mid).reduce((s, c) => s + c, 0);
  return first > 0 ? second / first : 1;
}

function getTimezoneOffsetMs(tz: string, date: Date): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: tz });
  return new Date(tzStr).getTime() - new Date(utcStr).getTime();
}

function terminalFilter(cutoff: Date | null) {
  const base = inArray(mmaBatch.status, TERMINAL_MMA_STATUS);
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
  source: UsageSource;
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

export interface OrgOverviewResult {
  headline: OrgUsageHeadline;
  costByTeam: OrgTeamUsageRow[];
  infraBreakdown: OrgInfraBreakdownRow[];
  trend: { orgTotal: UsagePoint[] };
}

export interface UsageDeps {
  db?: Db;
  teamId?: string | null;
  scope?: 'team' | 'org';
}

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
  const termCond = inArray(mmaBatch.status, TERMINAL_MMA_STATUS);
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
  const termCond = inArray(mmaBatch.status, TERMINAL_MMA_STATUS);

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

  // Two batched reads instead of two PER TEAM. This loop used to issue `select team` plus
  // `count(member)` for every row, sequentially awaited, so an org with T teams paid 2T
  // round-trips to render one dashboard.
  const teamIds = costByTeamRows.map((r) => r.teamId).filter((id): id is string => !!id);
  const teamNameById = new Map(
    teamIds.length === 0
      ? []
      : (await db.select({ id: team.id, name: team.name }).from(team).where(inArray(team.id, teamIds)))
          .map((t) => [t.id, t.name] as const),
  );
  const memberCountByTeam = new Map(
    teamIds.length === 0
      ? []
      : (
          await db
            .select({ teamId: member.teamId, count: sql<number>`count(*)::int` })
            .from(member)
            .where(inArray(member.teamId, teamIds))
            .groupBy(member.teamId)
        ).map((r) => [r.teamId, r.count] as const),
  );

  for (const row of costByTeamRows) {
    const memberCount = memberCountByTeam.get(row.teamId!) ?? 0;
    totalMemberCount += memberCount;

    costByTeam.push({
      teamId: row.teamId!,
      teamName: teamNameById.get(row.teamId!) ?? 'Unknown',
      memberCount,
      costUsd: row.costUsd,
      savedUsd: row.savedUsd,
      costShareRatio: headline.totalCostUsd > 0 ? row.costUsd / headline.totalCostUsd : 0,
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

  // Trend: org-total daily series (day buckets in TIMEZONE) — cost, savings, and dispatch
  // count per day feed the dashboard's volume-and-cost chart. Org total only; there is no
  // per-team series in the result (the comment here used to promise per-team sparklines
  // "left empty", but the field they would have filled does not exist).
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
  const trend = { orgTotal };

  headline.trendRatio = trendRatio(orgTotal.map((p) => p.costUsd));

  // No `teamDrilldown` here any more. It picked `costByTeamRows[0]` — an arbitrary team —
  // carried `dispatchCount: 0` with a comment saying a real count "would require a
  // separate query", and set `byRoute` to the ORG-WIDE breakdown, so it labelled every
  // team's routes as that one team's. Nothing rendered it. Building a real per-team
  // drilldown is a feature; shipping a placeholder shaped like one is how a wrong number
  // reaches a page later.
  return {
    headline,
    costByTeam,
    infraBreakdown,
    trend,
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

export async function usageByProject(
  period: Period,
  deps: UsageDeps = {},
): Promise<ProjectUsageRow[]> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);
  const cutoffCond = cutoff ? gte(mmaBatch.createdAt, cutoff) : undefined;
  const termCond = inArray(mmaBatch.status, TERMINAL_MMA_STATUS);
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

  // Sum batch costs for all batches linked to each loop's runs. Anchor this pass on the RUN's
  // start time + team (lr.started_at / lr.team_id) — the SAME anchor as runRows — not the batch's
  // created_at: filtering costs by created_at while runs filter by startedAt dropped a loop's cost
  // entirely at period edges (runs before the cutoff but batch after → not in runRows, so the cost
  // map entry was never read) or reported cost 0 (run inside the period, batch just after).
  const costWhere = deps.teamId
    ? cutoff
      ? sql`lr.started_at >= ${cutoff.toISOString()} AND lr.team_id = ${deps.teamId}`
      : sql`lr.team_id = ${deps.teamId}`
    : cutoff ? sql`lr.started_at >= ${cutoff.toISOString()}` : undefined;

  const costRows = await db
    .select({
      loopId: sql<string>`lr.loop_id`,
      costUsd: sql<number>`coalesce(sum(b.cost_usd::numeric), 0)::float`,
      savedUsd: sql<number>`coalesce(sum(b.saved_vs_main_usd::numeric), 0)::float`,
      tokens: sql<number>`coalesce(sum(coalesce(b.input_tokens, 0) + coalesce(b.output_tokens, 0)), 0)::int`,
      durationMs: sql<number>`coalesce(sum(b.duration_ms), 0)::int`,
    })
    .from(sql`forge.ops_mma_batch b`)
    // Prefer the FK (b.loop_run_id); fall back to the legacy link ONLY when the FK is null — else a
    // batch that carries a FK could ALSO match a different run via the legacy id and be summed twice.
    .innerJoin(sql`forge.loop_run lr`, sql`b.loop_run_id = lr.id OR (b.loop_run_id IS NULL AND b.id = lr.mma_batch_id)`)
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
  const termCond = inArray(mmaBatch.status, TERMINAL_MMA_STATUS);
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
  source: UsageSource,
  period: Period,
  deps: UsageDeps = {},
): Promise<RouteAggRow[]> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);
  const cutoffCond = cutoff ? gte(mmaBatch.createdAt, cutoff) : undefined;
  const termCond = inArray(mmaBatch.status, TERMINAL_MMA_STATUS);
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
  const termCond = inArray(mmaBatch.status, TERMINAL_MMA_STATUS);
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
  const termCond = inArray(mmaBatch.status, TERMINAL_MMA_STATUS);
  const teamCond = teamScopeFilter(deps.teamId);

  // All batches linked to this loop's runs via loop_run_id or legacy mma_batch_id
  const loopBatchCond = sql`(${mmaBatch.loopRunId} IN (SELECT id FROM forge.loop_run WHERE loop_id = ${loopId})
    OR ${mmaBatch.id} IN (SELECT mma_batch_id FROM forge.loop_run WHERE loop_id = ${loopId} AND mma_batch_id IS NOT NULL))`;

  return routeAggQuery(and(termCond, cutoffCond, teamCond, loopBatchCond), db);
}
