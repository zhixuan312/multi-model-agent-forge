import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { actionLog } from '@/db/schema/audit';
import { logAction } from '@/observability/action-log';
import { ProjectEventBus, projectEventBus } from '@/sse/event-bus';

/**
 * Per-repo execute authorization + the advisory in-scheduler lock (Spec 7
 * §Per-repo execute authorization, error table "Two executors"). The high-trust
 * write is never silent: a member must explicitly "Authorize execute" against a
 * repo before any dispatch, recorded in `action_log` (action='execute',
 * target='repo:<name>') and surfaced to the whole team via `execute.notice`.
 *
 * The advisory lock is in-process (single-instance deploy; multi-instance must
 * harden to a DB lock — flagged in the spec). It prevents a second member
 * launching a concurrent build of the same repo in the same project.
 */

/** Process-wide in-flight execute locks, keyed `<projectId>:<repoId>`. */
const inFlight = new Set<string>();

function lockKey(projectId: string, repoId: string): string {
  return `${projectId}:${repoId}`;
}

export class ExecuteLockedError extends Error {
  constructor(repoName: string) {
    super(`Repo "${repoName}" is already being executed by another member.`);
    this.name = 'ExecuteLockedError';
  }
}

/**
 * Authorize + lock a repo for execute. Writes the `action_log` row, emits
 * `execute.notice`, and acquires the advisory lock. Throws `ExecuteLockedError`
 * if a build is already in flight for this repo in this project.
 */
export async function authorizeExecute(
  args: { projectId: string; repoId: string; repoName: string; memberId: string },
  deps: { db?: Db; bus?: ProjectEventBus } = {},
): Promise<() => void> {
  const db = deps.db ?? getDb();
  const bus = deps.bus ?? projectEventBus;
  const key = lockKey(args.projectId, args.repoId);
  if (inFlight.has(key)) throw new ExecuteLockedError(args.repoName);
  inFlight.add(key);

  await logAction(
    {
      projectId: args.projectId,
      memberId: args.memberId,
      action: 'execute',
      target: `repo:${args.repoName}`,
    },
    db,
  );
  bus.publish(args.projectId, { type: 'execute.notice', memberId: args.memberId, repo: args.repoName });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight.delete(key);
  };
}

/** Whether a repo currently holds the in-flight execute lock (test/diagnostics). */
export function isExecuteLocked(projectId: string, repoId: string): boolean {
  return inFlight.has(lockKey(projectId, repoId));
}

/**
 * Whether a member has an authorize-execute action_log row for a repo. The
 * route-level gate: a dispatch is rejected without a prior "Authorize execute".
 */
export async function hasExecuteAuthorization(
  db: Db,
  projectId: string,
  repoName: string,
): Promise<boolean> {
  const dbi = db ?? getDb();
  const [row] = await dbi
    .select({ id: actionLog.id })
    .from(actionLog)
    .where(
      and(
        eq(actionLog.projectId, projectId),
        eq(actionLog.action, 'execute'),
        eq(actionLog.target, `repo:${repoName}`),
      ),
    )
    .orderBy(desc(actionLog.createdAt))
    .limit(1);
  return Boolean(row);
}

/** The most-recent execute authorizer (member id) for a repo, or null. */
export async function lastExecuteAuthorizer(
  db: Db,
  projectId: string,
  repoName: string,
): Promise<string | null> {
  const dbi = db ?? getDb();
  const [row] = await dbi
    .select({ memberId: actionLog.memberId })
    .from(actionLog)
    .where(
      and(
        eq(actionLog.projectId, projectId),
        eq(actionLog.action, 'execute'),
        eq(actionLog.target, `repo:${repoName}`),
      ),
    )
    .orderBy(sql`${actionLog.createdAt} desc`)
    .limit(1);
  return row?.memberId ?? null;
}
