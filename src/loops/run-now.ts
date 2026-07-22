import { randomUUID } from 'node:crypto';
import { inArray, desc, eq, and } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { repo } from '@/db/schema/workspace';
import { loop as loopTable, loopRun, type LoopRunRow } from '@/db/schema/loop';
import { team } from '@/db/schema/team';
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
  goalOverride?: string;
  idempotencyKey?: string;
  reference?: string | null;
  context?: string | null;
  background?: boolean;
  runner?: typeof runLoop;
  /** Scope the loop lookup to this team — without it a team_admin could "Run now" another team's loop. */
  teamId?: string;
}

export type StartRunResult =
  | { kind: 'started'; runId: string }
  | { kind: 'not_found' }
  | { kind: 'wrong_mode' };

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
  const loop = await getLoop(loopId, { db, teamId: deps.teamId });
  if (!loop) return { kind: 'not_found' };
  // Mode/trigger guard: event-mode loops may ONLY be fired via the authenticated event
  // endpoint (trigger 'event'); firing one through the manual "Run now" or scheduler path
  // would bypass the per-loop bearer-token gate. Conversely, an 'event' trigger is only
  // valid against an event-mode loop. Reject the mismatch here so the invariant holds no
  // matter which caller reaches this seam.
  if (trigger === 'event' ? loop.mode !== 'event' : loop.mode === 'event') {
    return { kind: 'wrong_mode' };
  }
  const [currentTeam] = await db.select().from(team).where(eq(team.id, loop.teamId)).limit(1);
  if (!currentTeam) return { kind: 'not_found' };

  const repos = await loadRepos(db, loop.repoIds);
  const runId = deps.runId ?? randomUUID();

  // Pre-create the `running` rows synchronously so the run shows up in the UI +
  // history the instant "Run now" returns (the engine then UPDATES these rows).
  const runRowByRepoId = new Map<string, string>();
  for (const r of repos) {
    const [row] = await db
      .insert(loopRun)
      .values({
        teamId: loop.teamId,
        loopId,
        runId,
        repoId: r.id,
        trigger,
        status: 'running',
        idempotencyKey: deps.idempotencyKey ?? null,
        reference: deps.reference ?? null,
      })
      .returning({ id: loopRun.id });
    if (row?.id) runRowByRepoId.set(r.id, row.id);
  }

  const runDeps = deps.runDeps ?? await buildLoopRunDeps(currentTeam, { db });
  const runner = deps.runner ?? runLoop;

  const exec = runner(
    loop,
    repos,
    {
      runId,
      trigger,
      goalOverride: deps.goalOverride,
      idempotencyKey: deps.idempotencyKey,
      reference: deps.reference ?? null,
      context: deps.context ?? null,
      runRowByRepoId,
    },
    runDeps,
  );
  if (deps.background === false) await exec;
  else void Promise.resolve(exec).catch(() => {});

  return { kind: 'started', runId };
}

/** Run history for a loop, newest first (the per-repo rows; group by `runId` in the UI). */
export async function listLoopRuns(loopId: string, deps: { db?: Db; teamId?: string } = {}): Promise<LoopRunRow[]> {
  const db = deps.db ?? getDb();
  // Scope to the caller's team — otherwise a team_admin could read another team's run history by id.
  return db
    .select()
    .from(loopRun)
    .where(and(eq(loopRun.loopId, loopId), deps.teamId ? eq(loopRun.teamId, deps.teamId) : undefined))
    .orderBy(desc(loopRun.startedAt));
}

export { loopTable };
