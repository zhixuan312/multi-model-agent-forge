import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { auditPass } from '@/db/schema/artifacts';
import type { AuditPassRow } from '@/db/schema/artifacts';
import type { AuditVerdict } from '@/db/enums';
import { logAction } from '@/observability/action-log';
import { MmaClient } from '@/mma/client';
import { mmaBatch } from '@/db/schema/mma';
import { resolveWorkspaceRoot } from '@/git/workspace-root';

/**
 * Spec-stage audit loop (Spec 4 Part B / Key flow 5). Dispatch `audit(subtype=
 * 'spec')` via `MmaClient.dispatchAndWait`, parse findings from the terminal
 * envelope, and persist one `audit_pass` row per pass.
 *
 * THE DOCUMENT IS NEVER AUTO-EDITED. This module runs an audit, records the
 * outcome, and exposes the pass history. The user revises sections (Part A) and
 * re-assembles between passes, then triggers a re-audit.
 *
 * SCHEMA SOURCE OF TRUTH (F28). The finding shape + missing-report shape here are
 * derived from the MMA-side wire envelope (`multi-model-agent`
 * `packages/server/src/http/handlers/control/batch.ts` →
 * `{ headline, results, batchTimings, costSummary, structuredReport, error }`,
 * where `structuredReport.findings[]` is `{ severity, category, claim, evidence?,
 * suggestion? }` and `severity ∈ critical|high|medium|low`). NOTE the spec's
 * hand-authored `{severity,title,body_md,location}`/`info`/`{kind:'not_applicable'}`
 * shapes do NOT match production — corrected here against the real schema.
 */

/** Loop cap: bounds the per-RUN pass index (NOT the monotonic persisted pass_no). F2/F3/F19/F34. */
export const AUDIT_PASS_CAP = 4;

/** The severity tiers MMA emits (no `info`; verified against core/src/reporting/severity.ts). */
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

/** A single parsed finding (the two fields Forge relies on + display fields). */
export interface ParsedFinding {
  severity: FindingSeverity;
  category: string;
  claim: string;
  evidence: string;
  suggestion: string;
}

/** The outcome of parsing one terminal envelope. */
export type AuditParseResult =
  | {
      kind: 'report';
      findings: ParsedFinding[];
      /** True iff any finding is critical/high — the verdict gate. */
      hasCriticalOrHigh: boolean;
      /** The terminal headline (for surfacing). */
      headline: string;
      /** The read-route context block id (reusable on the next pass), if present. */
      contextBlockId: string | null;
    }
  | {
      /** A dispatch that returned NO structured report — a failed/incomplete audit, NOT a clean pass (F20). */
      kind: 'missing_report';
      headline: string;
    };

const VALID_SEVERITY = new Set<FindingSeverity>(['critical', 'high', 'medium', 'low']);

/**
 * Parse the MMA `audit` terminal envelope. PURE — no DB, no network. Returns the
 * findings + the critical/high gate, OR a `missing_report` outcome when the
 * envelope carries no parseable `structuredReport.findings` (F20).
 */
export function parseAuditEnvelope(envelope: unknown): AuditParseResult {
  const env = (envelope ?? {}) as {
    headline?: unknown;
    structuredReport?: unknown;
    contextBlockId?: unknown;
  };
  const headline = typeof env.headline === 'string' ? env.headline : '';

  const sr = env.structuredReport;
  // Missing-report guard (F20): no structured report object → not a pass.
  if (sr == null || typeof sr !== 'object') {
    return { kind: 'missing_report', headline };
  }
  const report = sr as { findings?: unknown; findingsOutcome?: unknown; kind?: unknown; summary?: unknown };
  // Defensive: MMA's `{kind:'not_applicable'}` form (absent report) → missing.
  if (report.kind === 'not_applicable' || report.findingsOutcome === 'not_applicable') {
    return { kind: 'missing_report', headline };
  }

  // Findings can be a direct array OR embedded as JSON inside the summary string
  let rawFindings: unknown[] | null = null;
  if (Array.isArray(report.findings)) {
    rawFindings = report.findings;
  } else if (typeof report.summary === 'string') {
    try {
      const cleaned = report.summary.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed?.findings)) rawFindings = parsed.findings;
    } catch { /* not parseable — fall through to missing_report */ }
  }

  if (!rawFindings) {
    return { kind: 'missing_report', headline };
  }

  const findings: ParsedFinding[] = rawFindings
    .map((f) => {
      const ff = (f ?? {}) as { severity?: unknown; category?: unknown; claim?: unknown; evidence?: unknown; suggestion?: unknown };
      const severity = (typeof ff.severity === 'string' ? ff.severity : '') as FindingSeverity;
      return {
        severity,
        category: typeof ff.category === 'string' ? ff.category : '',
        claim: typeof ff.claim === 'string' ? ff.claim : '',
        evidence: typeof ff.evidence === 'string' ? ff.evidence : '',
        suggestion: typeof ff.suggestion === 'string' ? ff.suggestion : '',
      };
    })
    .filter((f) => VALID_SEVERITY.has(f.severity));

  const hasCriticalOrHigh = findings.some((f) => f.severity === 'critical' || f.severity === 'high');
  const contextBlockId =
    typeof env.contextBlockId === 'string' && env.contextBlockId.length > 0 ? env.contextBlockId : null;

  return { kind: 'report', findings, hasCriticalOrHigh, headline, contextBlockId };
}

/** The next monotonic persisted pass_no for a project's spec audits (`max+1`). */
export async function nextPassNo(db: Db, projectId: string, scope: 'spec' | 'plan' = 'spec'): Promise<number> {
  const [row] = await db
    .select({ m: sql<number>`coalesce(max(${auditPass.passNo}), 0)` })
    .from(auditPass)
    .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, scope)));
  return (row?.m ?? 0) + 1;
}

/** One recorded pass + the parsed findings, returned to the caller for UI + loop control. */
export interface AuditPassResult {
  passNo: number;
  verdict: AuditVerdict;
  findingsCount: number;
  findings: ParsedFinding[];
  contextBlockId: string | null;
}

/** Thrown when a dispatch produced no parseable structured report (retryable; no row written). */
export class AuditIncompleteError extends Error {
  readonly headline: string;
  constructor(headline: string) {
    super('The audit did not finish — try again.');
    this.name = 'AuditIncompleteError';
    this.headline = headline;
  }
}

export interface RunAuditPassDeps {
  db?: Db;
  mma: MmaClient;
  /** Workspace root override (tests); defaults to `resolveWorkspaceRoot()`. */
  workspaceRoot?: string;
}

/**
 * Run ONE audit pass: dispatch `audit(subtype='spec')` against the workspace root
 * with the inline assembled spec document, parse the terminal envelope, and
 * persist an `audit_pass` row (verdict 'clean' iff no critical/high, else
 * 'revised'). Returns the parsed pass.
 *
 * On a missing/incomplete report (F20) NO row is written and `AuditIncompleteError`
 * is thrown so the route can surface a retryable error and keep freeze gated.
 *
 * `contextBlockIds` (from a prior pass) is forwarded so a re-audit can reuse the
 * registered spec block instead of re-uploading it.
 */
export async function runAuditPass(
  deps: RunAuditPassDeps,
  args: {
    projectId: string;
    specMd: string;
    actorId: string;
    contextBlockIds?: string[];
  },
): Promise<AuditPassResult> {
  const db = deps.db ?? getDb();
  const cwd = deps.workspaceRoot ?? resolveWorkspaceRoot();

  const body: Record<string, unknown> = { subtype: 'spec', document: args.specMd };
  if (args.contextBlockIds && args.contextBlockIds.length > 0) {
    body.contextBlockIds = args.contextBlockIds;
  }

  const envelope = await deps.mma.dispatchAndWait('audit', { cwd, body });
  const parsed = parseAuditEnvelope(envelope);

  if (parsed.kind === 'missing_report') {
    // Failed/incomplete audit — no audit_pass row, no verdict, freeze stays gated (F20).
    throw new AuditIncompleteError(parsed.headline);
  }

  const passNo = await nextPassNo(db, args.projectId);
  const verdict: AuditVerdict = parsed.hasCriticalOrHigh ? 'revised' : 'clean';

  await db.transaction(async (tx) => {
    await tx.insert(auditPass).values({
      projectId: args.projectId,
      scope: 'spec',
      passNo,
      findingsCount: parsed.findings.length,
      verdict,
      mmaBatchId: null,
    });
    await logAction(
      { projectId: args.projectId, memberId: args.actorId, action: 'audit', target: `pass:${passNo}` },
      tx as unknown as Db,
    );
  });

  return {
    passNo,
    verdict,
    findingsCount: parsed.findings.length,
    findings: parsed.findings,
    contextBlockId: parsed.contextBlockId,
  };
}

/** A pass-history row for the UI timeline ("pass 1: 2 findings → revised · pass 2: clean"). */
export interface AuditPassView {
  passNo: number;
  findingsCount: number;
  verdict: AuditVerdict;
  createdAt: Date;
  findings: ParsedFinding[];
  applied: boolean;
}

/** The full audit-pass history for a project+scope, oldest-first. */
export async function auditPassHistory(db: Db, projectId: string, scope: 'spec' | 'plan' = 'spec'): Promise<AuditPassView[]> {
  const dbi = db ?? getDb();
  const rows = await dbi
    .select({
      passNo: auditPass.passNo,
      findingsCount: auditPass.findingsCount,
      verdict: auditPass.verdict,
      createdAt: auditPass.createdAt,
      batchResult: mmaBatch.result,
    })
    .from(auditPass)
    .leftJoin(mmaBatch, eq(auditPass.mmaBatchId, mmaBatch.id))
    .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, scope)))
    .orderBy(asc(auditPass.passNo));

  // Check if any completed spec-audit-apply batches exist for this project
  const applyBatches = await dbi
    .select({ terminalAt: mmaBatch.terminalAt })
    .from(mmaBatch)
    .where(and(
      eq(mmaBatch.projectId, projectId),
      eq(mmaBatch.handler, scope === 'plan' ? 'plan-audit-apply' : 'spec-audit-apply'),
      eq(mmaBatch.status, 'done'),
    ))
    .orderBy(desc(mmaBatch.terminalAt))
    .limit(1);
  const lastAppliedAt = applyBatches[0]?.terminalAt ?? null;

  return rows.map((r) => {
    let findings: ParsedFinding[] = [];
    if (r.batchResult) {
      const parsed = parseAuditEnvelope(r.batchResult);
      if (parsed.kind === 'report') findings = parsed.findings;
    }
    // A pass is "applied" if a spec-audit-apply batch completed after this pass was created
    const applied = lastAppliedAt != null && lastAppliedAt > r.createdAt;
    return {
      passNo: r.passNo,
      findingsCount: r.findingsCount,
      verdict: r.verdict as AuditVerdict,
      createdAt: r.createdAt,
      findings,
      applied,
    };
  });
}

/** The latest spec audit_pass row (verdict gate for freeze), or null if none run. */
export async function latestAuditPass(db: Db, projectId: string): Promise<AuditPassRow | null> {
  const dbi = db ?? getDb();
  const [row] = await dbi
    .select()
    .from(auditPass)
    .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'spec')))
    .orderBy(desc(auditPass.passNo))
    .limit(1);
  return row ?? null;
}
