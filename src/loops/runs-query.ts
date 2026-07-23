import { eq, and, desc } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { loopRun, type LoopRunRow } from '@/db/schema/loop';

/**
 * Read queries for loop runs (the "transactions"). Feeds the two surfaces:
 *   - run history (`listAllRuns`)      — the team's runs, optionally filtered by loop/status
 *   - index chip  (`latestRunPerLoop`) — newest run per loop, within the team
 * All IO is injected via `deps.db` so tests run on the mock DB (never production).
 *
 * `teamId` is REQUIRED (fail-closed). loop_run rows are team-owned; an unscoped
 * query returns every team's history, so both surfaces MUST constrain by team.
 * Making it a required argument means a caller that forgets it fails to compile
 * rather than silently leaking across teams (the class of bug this closes).
 */
export interface RunsQueryDeps {
  db?: Db;
  teamId: string;
}

export interface AllRunsFilter {
  loopId?: string;
  status?: LoopRunRow['status'];
  limit?: number;
}

export async function listAllRuns(filter: AllRunsFilter & RunsQueryDeps): Promise<LoopRunRow[]> {
  const db = filter.db ?? getDb();
  const conds = [eq(loopRun.teamId, filter.teamId)];
  if (filter.loopId) conds.push(eq(loopRun.loopId, filter.loopId));
  if (filter.status) conds.push(eq(loopRun.status, filter.status));
  const ordered = db.select().from(loopRun).where(and(...conds)).orderBy(desc(loopRun.startedAt));
  return filter.limit ? ordered.limit(filter.limit) : ordered;
}

/** Newest run per loop, keyed by loopId — drives the index "last run" chip. Team-scoped. */
export async function latestRunPerLoop(deps: RunsQueryDeps): Promise<Record<string, LoopRunRow>> {
  const db = deps.db ?? getDb();
  const rows = await db
    .select()
    .from(loopRun)
    .where(eq(loopRun.teamId, deps.teamId))
    .orderBy(desc(loopRun.startedAt));
  const out: Record<string, LoopRunRow> = {};
  for (const r of rows) if (!out[r.loopId]) out[r.loopId] = r;
  return out;
}
