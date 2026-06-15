import { randomUUID } from 'node:crypto';
import { inArray, desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { repo } from '@/db/schema/workspace';
import { loop as loopTable, loopRun, type LoopRunRow } from '@/db/schema/loop';
import type { LoopTrigger } from '@/db/enums';
import { runLoop, type LoopRepoTarget, type LoopRunDeps } from '@/loops/run-engine';
import { buildLoopRunDeps } from '@/loops/run-deps';
import { getLoop } from '@/loops/loops-core';

/**
 * "Run now" + run-history (spec §5/§6). `startLoopRun` loads the loop + its target
 * repos, mints a `runId`, and fires the run engine. By default the run is fired in
 * the background (the request returns immediately with the `runId`); inject
 * `background: false` to await it (tests). The engine persists `loop_run` rows, so
 * progress/outcome is durable + pollable regardless.
 */
export interface StartRunDeps {
  db?: Db;
  runDeps?: LoopRunDeps;
  runId?: string;
  background?: boolean;
  runner?: typeof runLoop;
}

export type StartRunResult = { kind: 'started'; runId: string } | { kind: 'not_found' };

async function loadRepos(db: Db, repoIds: string[]): Promise<LoopRepoTarget[]> {
  if (repoIds.length === 0) return [];
  const rows = await db
    .select({ id: repo.id, name: repo.name, pathOnDisk: repo.pathOnDisk })
    .from(repo)
    .where(inArray(repo.id, repoIds));
  return rows;
}

export async function startLoopRun(
  loopId: string,
  trigger: LoopTrigger,
  deps: StartRunDeps = {},
): Promise<StartRunResult> {
  const db = deps.db ?? getDb();
  const loop = await getLoop(loopId, { db });
  if (!loop) return { kind: 'not_found' };

  const repos = await loadRepos(db, loop.repoIds);
  const runId = deps.runId ?? randomUUID();

  // Pre-create the `running` rows synchronously so the run shows up in the UI +
  // history the instant "Run now" returns (the engine then UPDATES these rows).
  const runRowByRepoId = new Map<string, string>();
  for (const r of repos) {
    const [row] = await db
      .insert(loopRun)
      .values({ loopId, runId, repoId: r.id, trigger, status: 'running' })
      .returning({ id: loopRun.id });
    if (row?.id) runRowByRepoId.set(r.id, row.id);
  }

  const runDeps = deps.runDeps ?? buildLoopRunDeps({ db });
  const runner = deps.runner ?? runLoop;

  const exec = runner(loop, repos, { runId, trigger, runRowByRepoId }, runDeps);
  if (deps.background === false) await exec;
  else void Promise.resolve(exec).catch(() => {});

  return { kind: 'started', runId };
}

/** Run history for a loop, newest first (the per-repo rows; group by `runId` in the UI). */
export async function listLoopRuns(loopId: string, deps: { db?: Db } = {}): Promise<LoopRunRow[]> {
  const db = deps.db ?? getDb();
  return db.select().from(loopRun).where(eq(loopRun.loopId, loopId)).orderBy(desc(loopRun.startedAt));
}

// Re-export so route handlers import the loop table type if needed.
export { loopTable };
