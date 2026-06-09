import { and, desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { auditPass } from '@/db/schema/artifacts';
import { actionLog } from '@/db/schema/audit';
import { logAction } from '@/observability/action-log';

/**
 * Freeze (Spec 4 Part B / Key flow 6) — the irreversible Design→Build boundary.
 *
 * Freeze flips `project.phase` design→frozen, stamps `frozen_at`, and marks the
 * spec stage `done`, ALL in a single transaction that re-reads `phase` and aborts
 * if the project is already past Design (no double-freeze, no two-member race).
 * There is NO un-freeze. The `data-phase` cold flip is downstream (the layout
 * RSC reads `phase`).
 *
 * Precondition (F5/F26): the latest spec `audit_pass.verdict='clean'`, OR an
 * `audit_override` `action_log` row exists for the project. There is no separate
 * persisted "user satisfaction" gate — the click itself is the confirmation.
 */

export type FreezeResult =
  | { ok: true; alreadyFrozen: false }
  | { ok: true; alreadyFrozen: true }
  | { ok: false; reason: 'not_clean' };

/** Thrown when a freeze is attempted on a project that is already past Design. */
export class FreezeIrreversibleError extends Error {
  constructor() {
    super('This project is already frozen — freeze is a point of no return.');
    this.name = 'FreezeIrreversibleError';
  }
}

/** True iff the freeze gate is satisfied: latest spec verdict 'clean' OR an audit_override row. */
export async function canFreeze(db: Db, projectId: string): Promise<boolean> {
  const dbi = db ?? getDb();
  const [latest] = await dbi
    .select({ verdict: auditPass.verdict })
    .from(auditPass)
    .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'spec')))
    .orderBy(desc(auditPass.passNo))
    .limit(1);
  if (latest?.verdict === 'clean') return true;

  const [override] = await dbi
    .select({ id: actionLog.id })
    .from(actionLog)
    .where(and(eq(actionLog.projectId, projectId), eq(actionLog.action, 'audit_override')))
    .limit(1);
  return Boolean(override);
}

/**
 * Freeze a project. Precondition-checks the freeze gate, then transactionally
 * flips phase + stamps `frozen_at` + advances the spec stage + writes the
 * `freeze` action_log — irreversibly. Idempotent-safe: a second call on an
 * already-frozen project returns `{ ok:true, alreadyFrozen:true }` without
 * mutating (the irreversibility guard fires inside the transaction on a true
 * race; a sequential re-call is a no-op).
 */
export async function freezeProject(
  projectId: string,
  actorId: string,
  deps: { db?: Db } = {},
): Promise<FreezeResult> {
  const db = deps.db ?? getDb();

  if (!(await canFreeze(db, projectId))) {
    return { ok: false, reason: 'not_clean' };
  }

  return db.transaction(async (tx) => {
    // Re-read phase INSIDE the transaction (row-locked) to defeat a double-freeze race.
    const [row] = await tx
      .select({ phase: project.phase })
      .from(project)
      .where(eq(project.id, projectId))
      .for('update')
      .limit(1);
    if (!row) throw new FreezeIrreversibleError();

    if (row.phase !== 'design') {
      // Already past Design — a no-op for a sequential re-call; the point of no return.
      return { ok: true, alreadyFrozen: true } as const;
    }

    const now = new Date();
    await tx
      .update(project)
      .set({ phase: 'frozen', frozenAt: now, updatedAt: now })
      .where(eq(project.id, projectId));

    await tx
      .update(stage)
      .set({ status: 'done', completedAt: now })
      .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'spec')));

    await logAction(
      { projectId, memberId: actorId, action: 'freeze', target: `project:${projectId}` },
      tx as unknown as Db,
    );

    return { ok: true, alreadyFrozen: false } as const;
  });
}

/** Record the cap-escape `audit_override` (F26) — the freeze-gate satisfier in lieu of 'clean'. */
export async function recordAuditOverride(
  projectId: string,
  actorId: string,
  deps: { db?: Db } = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  await logAction(
    { projectId, memberId: actorId, action: 'audit_override', target: `project:${projectId}` },
    db,
  );
}
