/**
 * Usage aggregation core — four query functions, one per tab.
 * All accept a period and return structured results for the Usage page.
 */
import { sql, and, eq, isNotNull, gte, inArray, not } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/mma';
import { project } from '@/db/schema/projects';
import { loop, loopRun } from '@/db/schema/loop';

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
}

export interface UsageDeps {
  db?: Db;
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

function resolveStage(route: string, subtype: string | null): string {
  if (route === 'audit') {
    if (subtype === 'spec') return 'spec';
    if (subtype === 'plan') return 'plan';
    return 'other';
  }
  return ROUTE_TO_STAGE[route] ?? 'other';
}

export async function usageOverview(
  period: Period,
  deps: UsageDeps = {},
): Promise<OverviewResult> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);
  const where = terminalFilter(cutoff);

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

  const [loopsRow] = await sourceAgg(
    and(termCond, cutoffCond, sql`${mmaBatch.id} IN ${loopBatchIds}`),
  );
  const [projectsRow] = await sourceAgg(
    and(
      termCond,
      cutoffCond,
      isNotNull(mmaBatch.projectId),
      sql`${mmaBatch.id} NOT IN ${loopBatchIds}`,
    ),
  );
  const [standaloneRow] = await sourceAgg(
    and(
      termCond,
      cutoffCond,
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

  return { metrics, bySources, byRoutes };
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
    .where(cutoffCond ? gte(loopRun.startedAt, cutoff!) : undefined)
    .groupBy(loop.id, loop.name, loop.kind);

  // Sum batch costs for all batches linked to each loop's runs
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
    .where(cutoff ? sql`b.created_at >= ${cutoff.toISOString()}` : undefined)
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
  tier: string | null;
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
      tier: mmaBatch.implementerTier,
      callCount: sql<number>`count(*)::int`,
      totalCostUsd: sql<number>`coalesce(sum(${mmaBatch.costUsd}::numeric), 0)::float`,
      totalSavedUsd: sql<number>`coalesce(sum(${mmaBatch.savedVsMainUsd}::numeric), 0)::float`,
      totalDurationMs: sql<number>`coalesce(sum(${mmaBatch.durationMs}), 0)::int`,
      avgCostUsd: sql<number>`coalesce(avg(${mmaBatch.costUsd}::numeric), 0)::float`,
      avgDurationMs: sql<number>`coalesce(avg(${mmaBatch.durationMs}), 0)::int`,
    })
    .from(mmaBatch)
    .where(extraCond)
    .groupBy(mmaBatch.route, mmaBatch.implementerTier)
    .orderBy(sql`sum(${mmaBatch.costUsd}::numeric) desc nulls last`);

  return rows.map((r) => ({
    route: r.route,
    tier: r.tier,
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

  let sourceCond;
  if (source === 'loops') {
    sourceCond = sql`${mmaBatch.id} IN ${loopBatchIds}`;
  } else if (source === 'projects') {
    sourceCond = and(isNotNull(mmaBatch.projectId), sql`${mmaBatch.id} NOT IN ${loopBatchIds}`);
  } else {
    sourceCond = and(sql`${mmaBatch.projectId} IS NULL`, sql`${mmaBatch.id} NOT IN ${loopBatchIds}`);
  }

  return routeAggQuery(and(termCond, cutoffCond, sourceCond), db);
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

  return routeAggQuery(
    and(termCond, cutoffCond, eq(mmaBatch.projectId, projectId), sql`${mmaBatch.id} NOT IN ${loopBatchIds}`),
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

  // All batches linked to this loop's runs via loop_run_id or legacy mma_batch_id
  const loopBatchCond = sql`(${mmaBatch.loopRunId} IN (SELECT id FROM forge.loop_run WHERE loop_id = ${loopId})
    OR ${mmaBatch.id} IN (SELECT mma_batch_id FROM forge.loop_run WHERE loop_id = ${loopId} AND mma_batch_id IS NOT NULL))`;

  return routeAggQuery(and(termCond, cutoffCond, loopBatchCond), db);
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
  implementerModel: string | null;
  createdAt: string;
}

export async function batchesForProject(
  projectId: string,
  period: Period,
  deps: UsageDeps = {},
): Promise<BatchDetailRow[]> {
  const db = deps.db ?? getDb();
  const cutoff = periodCutoff(period);

  const rows = await db
    .select({
      id: mmaBatch.id,
      route: mmaBatch.route,
      costUsd: mmaBatch.costUsd,
      durationMs: mmaBatch.durationMs,
      inputTokens: mmaBatch.inputTokens,
      outputTokens: mmaBatch.outputTokens,
      implementerModel: mmaBatch.implementerModel,
      createdAt: mmaBatch.createdAt,
    })
    .from(mmaBatch)
    .where(
      and(
        eq(mmaBatch.projectId, projectId),
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
    implementerModel: r.implementerModel,
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
        cutoff ? gte(loopRun.startedAt, cutoff) : undefined,
      ),
    )
    .orderBy(sql`${loopRun.startedAt} desc`)
    .limit(20);

  const result: Array<{ runId: string; startedAt: string; status: string; batches: BatchDetailRow[] }> = [];

  for (const run of runs) {
    const batches = await db
      .select({
        id: mmaBatch.id,
        route: mmaBatch.route,
        costUsd: mmaBatch.costUsd,
        durationMs: mmaBatch.durationMs,
        inputTokens: mmaBatch.inputTokens,
        outputTokens: mmaBatch.outputTokens,
        implementerModel: mmaBatch.implementerModel,
        createdAt: mmaBatch.createdAt,
      })
      .from(mmaBatch)
      .where(
        sql`(${mmaBatch.loopRunId} = ${run.id} OR ${mmaBatch.id} = ${run.mmaBatchId})
            AND ${mmaBatch.status} IN ('done', 'failed')`,
      )
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
        implementerModel: b.implementerModel,
        createdAt: b.createdAt.toISOString(),
      })),
    });
  }

  return result;
}
