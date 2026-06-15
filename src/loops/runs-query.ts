import { eq, and, desc } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { loopRun, type LoopRunRow } from '@/db/schema/loop';

/**
 * Read queries for loop runs (the "transactions"). Feeds the two surfaces:
 *   - run history (`listAllRuns`)      — all runs, optionally filtered by loop/status
 *   - index chip  (`latestRunPerLoop`) — newest run per loop
 * All IO is injected via `deps.db` so tests run on the mock DB (never production).
 */
export interface RunsQueryDeps {
  db?: Db;
}

export interface AllRunsFilter {
  loopId?: string;
  status?: LoopRunRow['status'];
  limit?: number;
}

export async function listAllRuns(filter: AllRunsFilter & RunsQueryDeps = {}): Promise<LoopRunRow[]> {
  const db = filter.db ?? getDb();
  const conds = [];
  if (filter.loopId) conds.push(eq(loopRun.loopId, filter.loopId));
  if (filter.status) conds.push(eq(loopRun.status, filter.status));
  const where = conds.length ? and(...conds) : undefined;
  const ordered = (where ? db.select().from(loopRun).where(where) : db.select().from(loopRun)).orderBy(
    desc(loopRun.startedAt),
  );
  return filter.limit ? ordered.limit(filter.limit) : ordered;
}

/** Newest run per loop, keyed by loopId — drives the index "last run" chip. */
export async function latestRunPerLoop(deps: RunsQueryDeps = {}): Promise<Record<string, LoopRunRow>> {
  const db = deps.db ?? getDb();
  const rows = await db.select().from(loopRun).orderBy(desc(loopRun.startedAt));
  const out: Record<string, LoopRunRow> = {};
  for (const r of rows) if (!out[r.loopId]) out[r.loopId] = r;
  return out;
}
