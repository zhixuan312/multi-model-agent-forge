import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { auditPass } from '@/db/schema/artifacts';
import { MmaClient } from '@/mma/client';
import { logAction } from '@/observability/action-log';
import { ProjectEventBus, projectEventBus } from '@/sse/event-bus';
import { parseAuditEnvelope } from '@/spec/audit-loop';
import type { AuditVerdict } from '@/db/enums';

/**
 * Plan-audit loop (Spec 7 §Audit loop; the 7a gate). Per write-target repo, run
 * `audit(subtype='plan')` on that repo's plan file, parse the terminal envelope,
 * persist one `audit_pass` row (scope='plan') per pass, and loop until no
 * critical/high finding remains (medium/low are advisory). The plan REVISION
 * between passes is the orchestrator's job (re-author + re-write the file); this
 * module owns one pass and the loop-control predicate.
 *
 * Reuses `parseAuditEnvelope` from the spec audit loop — the MMA audit envelope
 * shape is identical (`structuredReport.findings[]` severity-tagged).
 */

/** Loop cap (Spec 7 error table): plan-audit converges in ≤2 passes; 5 bounds a pathological loop. */
export const MAX_PLAN_AUDIT_PASSES = 5;

/** The next monotonic `pass_no` for a project's PLAN audits (max+1). */
export async function nextPlanPassNo(db: Db, projectId: string): Promise<number> {
  const [row] = await db
    .select({ m: sql<number>`coalesce(max(${auditPass.passNo}), 0)` })
    .from(auditPass)
    .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'plan')));
  return (row?.m ?? 0) + 1;
}

export interface PlanAuditPassResult {
  passNo: number;
  verdict: AuditVerdict;
  findingsCount: number;
  hasBlocking: boolean;
  /** The blocking (critical/high) finding claims, surfaced for revision. */
  blockingClaims: string[];
  contextBlockId: string | null;
}

/** Thrown when an audit dispatch produced no parseable structured report (retryable; no row). */
export class PlanAuditIncompleteError extends Error {
  readonly headline: string;
  constructor(headline: string) {
    super('The plan audit did not finish — try again.');
    this.name = 'PlanAuditIncompleteError';
    this.headline = headline;
  }
}

export interface RunPlanAuditPassDeps {
  db?: Db;
  mma: MmaClient;
  bus?: ProjectEventBus;
}

/**
 * Run ONE plan-audit pass for a repo: dispatch `audit(subtype='plan')` against the
 * repo's plan file, parse, persist an `audit_pass(scope='plan')` row, emit
 * `audit.pass`. Returns the parsed pass (the caller decides whether to loop).
 *
 * `verdict='revised'` iff any critical/high finding, else `'clean'`. On a missing
 * report NO row is written and `PlanAuditIncompleteError` is thrown.
 */
export async function runPlanAuditPass(
  deps: RunPlanAuditPassDeps,
  args: {
    projectId: string;
    repoName: string;
    repoCwd: string;
    planFilePath: string;
    actorId: string;
    contextBlockIds?: string[];
  },
): Promise<PlanAuditPassResult> {
  const db = deps.db ?? getDb();
  const bus = deps.bus ?? projectEventBus;

  const { batchId } = await deps.mma.auditPlan(args.repoCwd, {
    paths: [args.planFilePath],
    ...(args.contextBlockIds && args.contextBlockIds.length > 0
      ? { contextBlockIds: args.contextBlockIds }
      : {}),
  });
  const terminal = await pollToTerminal(deps.mma, batchId);
  const parsed = parseAuditEnvelope(terminal);

  if (parsed.kind === 'missing_report') {
    throw new PlanAuditIncompleteError('No structured report returned');
  }

  const passNo = await nextPlanPassNo(db, args.projectId);
  const verdict: AuditVerdict = parsed.hasCriticalOrHigh ? 'revised' : 'clean';
  const blockingClaims = parsed.findings
    .filter((f) => f.severity === 'critical' || f.severity === 'high')
    .map((f) => f.claim);

  await db.transaction(async (tx) => {
    await tx.insert(auditPass).values({
      projectId: args.projectId,
      scope: 'plan',
      passNo,
      findingsCount: parsed.findings.length,
      verdict,
      mmaBatchId: null,
    });
    await logAction(
      { projectId: args.projectId, memberId: args.actorId, action: 'audit_plan', target: `pass:${passNo}` },
      tx as unknown as Db,
    );
  });

  bus.publish(args.projectId, {
    type: 'audit.pass',
    repo: args.repoName,
    pass: passNo,
    findingsCount: parsed.findings.length,
    verdict,
  });

  return {
    passNo,
    verdict,
    findingsCount: parsed.findings.length,
    hasBlocking: parsed.hasCriticalOrHigh,
    blockingClaims,
    contextBlockId: parsed.contextBlockId,
  };
}

/** Poll a batch id to terminal via the client's poll loop (reuses MmaClient.poll). */
async function pollToTerminal(mma: MmaClient, batchId: string): Promise<unknown> {
  for (;;) {
    const r = await mma.poll(batchId);
    if (r.state === 'terminal') return r.envelope;
    await new Promise((res) => setTimeout(res, 25));
  }
}

/** The full plan audit-pass history for a project, oldest-first (Plan-pane ledger). */
export async function planAuditHistory(db: Db, projectId: string) {
  const dbi = db ?? getDb();
  return dbi
    .select({
      passNo: auditPass.passNo,
      findingsCount: auditPass.findingsCount,
      verdict: auditPass.verdict,
      createdAt: auditPass.createdAt,
    })
    .from(auditPass)
    .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'plan')))
    .orderBy(asc(auditPass.passNo));
}
