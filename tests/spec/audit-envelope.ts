// Terminal-envelope fixtures for the spec audit-loop tests.
//
// This was once `mock-mma.ts` and also exported a `mockMma()` helper that wrapped a
// real `MmaClient` around a fetch stub so the dispatch→poll path ran end to end.
// Nothing imported it: the audit-loop tests exercise `parseAuditEnvelope` against a
// canned envelope directly, which is the seam that actually has logic. The unused
// client stub, its `RecordedDispatch` type, and a `journalEnvelope()` factory were
// removed rather than kept as scaffolding for a test nobody wrote.

/** A v5.4 audit terminal envelope. */
export function auditEnvelope(
  findings: Array<{ severity: string; category?: string; claim?: string }>,
  extra?: { contextBlockId?: string },
): unknown {
  return {
    task: { type: 'audit', status: 'done', taskId: 'mock-audit' },
    output: {
      summary: {
        findings: findings.map((f) => ({
          severity: f.severity,
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
