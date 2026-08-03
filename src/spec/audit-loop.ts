import { and, eq, inArray } from 'drizzle-orm';
import { parseLlmJson } from '@/lib/llm-json';
import type { Db } from '@/db/client';
import type { AuditVerdict } from '@/db/enums';
import type { Finding } from '@/components/patterns/findings';
import { mmaBatch } from '@/db/schema/ops';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';
import { SEVERITY_ORDER, isBlockingSeverity, type Severity } from '@/lib/severity';

/**
 * Audit parsing + queries shared by spec and plan audits. `parseAuditEnvelope`
 * + `nextPassNo` are used by both handlers; `auditPassHistory` serves the UI.
 * Dispatch is async via `dispatchMma`.
 */

/** The severity tiers MMA emits (no `info`; verified against the engine's
 *  `packages/core/src/unified/refiner-schemas.ts`, which enumerates the same four). */
export type FindingSeverity = Severity;

/**
 * A finding parsed out of an audit envelope: the canonical render contract with
 * `evidence`/`suggestion` GUARANTEED present (the parser defaults them to ''). Extending
 * `Finding` rather than restating its fields means the shape has one definition — adding a
 * field to the rendered contract cannot silently skip the parser. `Finding` is a type-only
 * import from a `'use client'` module, which erases at compile time.
 */
export interface ParsedFinding extends Finding {
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

const VALID_SEVERITY = new Set<FindingSeverity>(SEVERITY_ORDER);

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
    const parsed = parseLlmJson(summary);
    if (parsed && typeof parsed === 'object') report = parsed as Record<string, unknown>;
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
    const parsed = parseLlmJson<{ findings?: unknown }>(report.summary as string);
    if (Array.isArray(parsed?.findings)) rawFindings = parsed.findings;
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

  const hasCriticalOrHigh = findings.some((f) => isBlockingSeverity(f.severity));
  const ctxBlock = (output.contextBlockId ?? env.contextBlockId) as string | undefined;
  const contextBlockId = typeof ctxBlock === 'string' && ctxBlock.length > 0 ? ctxBlock : null;

  return { kind: 'report', findings, hasCriticalOrHigh, contextBlockId };
}

/** The next monotonic persisted pass_no for a project's spec audits (`max+1`). */
export async function nextPassNo(db: Db, projectId: string, scope: 'spec' | 'plan' = 'spec'): Promise<number> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (row?.details) {
    const d = validateDetails(row.details);
    const passes = scope === 'spec'
      ? d.stages.spec.phases.finalize.auditPasses
      : d.stages.plan.phases.validate.auditPasses;
    return passes.length + 1;
  }
  return 1;
}

/** A pass-history row for the UI timeline ("pass 1: 2 findings → revised · pass 2: clean"). */
export interface AuditPassView {
  passNo: number;
  findingsCount: number;
  verdict: AuditVerdict;
  findings: ParsedFinding[];
  /** Any fix attempt was recorded for this pass. Kept for the rail's "applied" chip. */
  applied: boolean;
  /**
   * WHICH findings were applied, by index into `findings`.
   *
   * Derived from the apply batches' recorded `findingIndices`, the way the Review stage has
   * always done it. Without this the UI could only fall back to the whole-round `applied`
   * boolean, which marks un-applied findings as applied and locks the round — so a user who
   * applied 2 of 5 could neither see which 2 nor finish the other 3.
   */
  appliedIndices: number[];
}

/** The full audit-pass history for a project+scope, oldest-first. */
export async function auditPassHistory(db: Db, projectId: string, scope: 'spec' | 'plan' = 'spec'): Promise<AuditPassView[]> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return [];
  const d = validateDetails(row.details);
  const passes = scope === 'spec'
    ? d.stages.spec.phases.finalize.auditPasses
    : d.stages.plan.phases.validate.auditPasses;

  // One read for every pass's envelope, not one read PER pass. This loop used to await a
  // single-row `select` inside it, so a project on its fifth audit round paid five
  // sequential round-trips to render the history rail.
  const batchIds = passes
    .map((p) => p.audit?.attempts?.[0]?.batchId)
    .filter((id): id is string => !!id);
  const resultByBatch = new Map(
    batchIds.length === 0
      ? []
      : (await db.select({ id: mmaBatch.id, result: mmaBatch.result }).from(mmaBatch).where(inArray(mmaBatch.id, batchIds)))
          .map((b) => [b.id, b.result] as const),
  );

  // One read for every pass's applied indices. `apply_findings` records `passNo` +
  // `findingIndices` in the dispatch meta, which lands in the batch `request` column.
  const applyBatches = await db
    .select({ request: mmaBatch.request })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, projectId), eq(mmaBatch.handler, `${scope}-audit-apply`)))
    .orderBy(mmaBatch.createdAt);
  const appliedByPass = new Map<number, Set<number>>();
  for (const b of applyBatches) {
    const req = (b.request ?? {}) as { passNo?: unknown; findingIndices?: unknown };
    if (typeof req.passNo !== 'number' || !Array.isArray(req.findingIndices)) continue;
    const set = appliedByPass.get(req.passNo) ?? new Set<number>();
    for (const i of req.findingIndices) if (Number.isInteger(i)) set.add(i as number);
    appliedByPass.set(req.passNo, set);
  }

  const results: AuditPassView[] = [];
  for (const p of passes) {
    let findings: ParsedFinding[] = [];
    const batchId = p.audit?.attempts?.[0]?.batchId;
    const result = batchId ? resultByBatch.get(batchId) : undefined;
    if (result) {
      const parsed = parseAuditEnvelope(result);
      if (parsed.kind === 'report') findings = parsed.findings;
    }
    results.push({
      passNo: p.passNo,
      findingsCount: findings.length,
      verdict: p.status as AuditVerdict,
      findings,
      applied: !!p.fix?.attempts?.length,
      appliedIndices: [...(appliedByPass.get(p.passNo) ?? [])].sort((a, b) => a - b),
    });
  }
  return results;
}
