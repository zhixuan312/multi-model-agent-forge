// Terminal-envelope fixtures for the spec audit-loop tests.
//
// This was once `mock-mma.ts` and also exported a `mockMma()` helper that wrapped a
// real `MmaClient` around a fetch stub so the dispatch→poll path ran end to end.
// Nothing imported it: the audit-loop tests exercise `parseAuditEnvelope` against a
// canned envelope directly, which is the seam that actually has logic. The unused
// client stub, its `RecordedDispatch` type, and a `journalEnvelope()` factory were
// removed rather than kept as scaffolding for a test nobody wrote.

/**
 * A v5.4 audit terminal envelope.
 *
 * Emits the severity under **`weight`**, which is what the engine actually sends: every
 * schema in the engine's `packages/core/src/unified/refiner-schemas.ts` declares
 * `weight: severityEnum`, and `review-findings.test.ts` records the same thing measured
 * from the other side — across 37 real envelopes in the batch store, a `severity` key
 * occurred **zero** times.
 *
 * This fixture used to emit `severity`, so nearly every audit case exercised the PARSER'S
 * TOLERANCE rather than its contract, and the wire key the engine really uses appeared in
 * one describe block at the bottom of the file. A fixture that disagrees with production
 * quietly redirects a whole file's coverage onto a path production never takes. The
 * `severity` alias is still tolerated and still tested — as an alias, explicitly.
 *
 * The argument is named `severity` because that is the concept; the wire key is the
 * translation this fixture exists to perform.
 */
export function auditEnvelope(
  findings: Array<{ severity: string; category?: string; claim?: string }>,
  extra?: { contextBlockId?: string; key?: 'weight' | 'severity' },
): unknown {
  const key = extra?.key ?? 'weight';
  return {
    task: { type: 'audit', status: 'done', taskId: 'mock-audit' },
    output: {
      summary: {
        findings: findings.map((f) => ({
          [key]: f.severity,
          category: f.category ?? 'coherence',
          claim: f.claim ?? 'a finding',
        })),
        findingsOutcome: findings.length > 0 ? 'found' : 'clean',
      },
      filesChanged: [],
      contextBlockId: extra?.contextBlockId ?? null,
    },
    execution: { sessions: { implementer: 'mock', reviewer: null }, worktree: null },
    metrics: { totalCostUsd: 0, totalDurationMs: 0, totalUsage: { inputTokens: 0, outputTokens: 0 }, implementer: null, reviewer: null },
    raw: { implementer: '', reviewer: null },
    error: null,
  };
}
