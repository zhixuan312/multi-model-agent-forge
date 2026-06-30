import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { auditPass } from '@/db/schema/artifacts';
import type { AuditPassRow } from '@/db/schema/artifacts';
import type { AuditVerdict } from '@/db/enums';
import { mmaBatch } from '@/db/schema/ops';

/**
 * Audit parsing + queries shared by spec and plan audits. `parseAuditEnvelope`
 * + `nextPassNo` are used by both handlers. `auditPassHistory` + `latestAuditPass`
 * serve the UI. Dispatch is async via `dispatchAndRegister`.
 */

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
      /** The read-route context block id (reusable on the next pass), if present. */
      contextBlockId: string | null;
    }
  | {
      /** A dispatch that returned NO structured report — a failed/incomplete audit, NOT a clean pass. */
      kind: 'missing_report';
    };

const VALID_SEVERITY = new Set<FindingSeverity>(['critical', 'high', 'medium', 'low']);

/**
 * Parse the MMA `audit` terminal envelope. PURE — no DB, no network. Returns the
 * findings + the critical/high gate, OR a `missing_report` outcome when the
 * envelope carries no parseable `structuredReport.findings`.
 */
export function parseAuditEnvelope(envelope: unknown): AuditParseResult {
  const env = (envelope ?? {}) as Record<string, unknown>;
  const output = (env.output ?? {}) as Record<string, unknown>;
  const summary = output.summary;

  // v5.4: output.summary is the report (object or JSON string)
  let report: Record<string, unknown> | null = null;
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    report = summary as Record<string, unknown>;
  } else if (typeof summary === 'string') {
    try {
      const cleaned = summary.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object') report = parsed as Record<string, unknown>;
    } catch { /* not parseable */ }
  }

  if (!report) {
    return { kind: 'missing_report' };
  }
  if (report.kind === 'not_applicable' || report.findingsOutcome === 'not_applicable') {
    return { kind: 'missing_report' };
  }

  let rawFindings: unknown[] | null = null;
  if (Array.isArray(report.findings)) {
    rawFindings = report.findings;
  } else if (typeof report.summary === 'string') {
    try {
      const cleaned = (report.summary as string).replace(/^```json\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed?.findings)) rawFindings = parsed.findings;
    } catch { /* not parseable */ }
  }

  if (!rawFindings) {
    return { kind: 'missing_report' };
  }

  const findings: ParsedFinding[] = rawFindings
    .map((f) => {
      const ff = (f ?? {}) as Record<string, unknown>;
      const severity = (typeof ff.severity === 'string' ? ff.severity
        : typeof ff.weight === 'string' ? ff.weight : '') as FindingSeverity;
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
  const ctxBlock = (output.contextBlockId ?? env.contextBlockId) as string | undefined;
  const contextBlockId = typeof ctxBlock === 'string' && ctxBlock.length > 0 ? ctxBlock : null;

  return { kind: 'report', findings, hasCriticalOrHigh, contextBlockId };
}

/** The next monotonic persisted pass_no for a project's spec audits (`max+1`). */
export async function nextPassNo(db: Db, projectId: string, scope: 'spec' | 'plan' = 'spec'): Promise<number> {
  const [row] = await db
    .select({ m: sql<number>`coalesce(max(${auditPass.passNo}), 0)` })
    .from(auditPass)
    .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, scope)));
  return (row?.m ?? 0) + 1;
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

  // Find which pass numbers have completed apply batches
  const applyBatches = await dbi
    .select({ request: mmaBatch.request })
    .from(mmaBatch)
    .where(and(
      eq(mmaBatch.projectId, projectId),
      eq(mmaBatch.handler, scope === 'plan' ? 'plan-audit-apply' : 'spec-audit-apply'),
      eq(mmaBatch.status, 'done'),
    ));
  const appliedPassNos = new Set<number>();
  for (const b of applyBatches) {
    const req = b.request as Record<string, unknown> | null;
    if (req && typeof req.passNo === 'number') appliedPassNos.add(req.passNo);
  }

  return rows.map((r) => {
    let findings: ParsedFinding[] = [];
    if (r.batchResult) {
      const parsed = parseAuditEnvelope(r.batchResult);
      if (parsed.kind === 'report') findings = parsed.findings;
    }
    return {
      passNo: r.passNo,
      findingsCount: r.findingsCount,
      verdict: r.verdict as AuditVerdict,
      createdAt: r.createdAt,
      findings,
      applied: appliedPassNos.has(r.passNo),
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
