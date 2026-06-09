/**
 * Pure interpretation of the MMA `execute-plan` terminal envelope (Spec 7
 * §Execute step 3/4). No DB, no git, no network.
 *
 * The wire envelope is the 7-field `{ headline, results, batchTimings,
 * costSummary, structuredReport, error }` shape (verified against MMA
 * `packages/server/src/http/handlers/control/batch.ts`). The fields this module
 * reads:
 *   - `structuredReport.commitSha`   — the MMA worker commit SHA (null = no commit)
 *   - `structuredReport.commitSkipReason` — the no-op reason (e.g. 'no_diff'/'no_repo')
 *   - `structuredReport.filesChanged` — FileChange[] (real field; there is NO `filesWritten`)
 *   - `structuredReport.unresolved`   — string[] (worker blocking notes)
 *   - per-task `results[i].error.code` — the structured error code (halt-set keying)
 *   - top-level `error.code`           — the batch error code (fallback)
 *   - `costSummary.totalActualCostUSD` — for the running-cost tick
 *
 * NOTE on the spec's `terminalStatus`/`errorCode`: the public wire envelope does
 * NOT project a literal `terminalStatus`/`errorCode` per task — it exposes the
 * structured `error.{code,message}` (top-level + per-task) and per-task `status`.
 * The halt predicate therefore keys on the real `error.code` against the spec's
 * enumerated halt set, plus the `structuredReport` empty-filesChanged +
 * non-empty-unresolved branch. (Documented deviation from the spec's field names;
 * the SEMANTICS are exactly the spec's.)
 */

/** The enumerated halt-for-decision error codes (Spec 7 §Execute step 4a). */
export const HALT_ERROR_CODES = new Set([
  'validator_silent_incomplete',
  'validator_no_artifacts',
  'lifecycle_review_loop_capped',
  'validator_dirty_worktree',
  'validator_no_changes',
]);

export interface CommitPayload {
  /** The MMA worker commit SHA, or null when nothing was committed (no_op). */
  commitSha: string | null;
  /** The no-op reason (e.g. 'no_diff', 'no_repo'), when no commit landed. */
  commitSkipReason: string | null;
}

export interface ParsedExecuteEnvelope {
  commit: CommitPayload;
  filesChanged: string[];
  unresolved: string[];
  /** The structured error code (per-task first, else top-level), or null. */
  errorCode: string | null;
  /** Total batch cost in USD (for the cost tick). */
  costUsd: number;
  /** The terminal headline. */
  headline: string;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Parse the execute-plan terminal envelope into the fields the executor reads. */
export function parseExecuteEnvelope(envelope: unknown): ParsedExecuteEnvelope {
  const env = asObj(envelope);
  const sr = asObj(env.structuredReport);

  const commitSha = typeof sr.commitSha === 'string' && sr.commitSha.length > 0 ? sr.commitSha : null;
  const commitSkipReason =
    typeof sr.commitSkipReason === 'string' && sr.commitSkipReason.length > 0 ? sr.commitSkipReason : null;

  const filesChanged = Array.isArray(sr.filesChanged)
    ? sr.filesChanged
        .map((f) => {
          const fc = asObj(f);
          return typeof fc.path === 'string' ? fc.path : '';
        })
        .filter((p) => p.length > 0)
    : [];

  const unresolved = Array.isArray(sr.unresolved)
    ? sr.unresolved.filter((u): u is string => typeof u === 'string')
    : [];

  // Error code: prefer the first per-task result error, else top-level error.
  let errorCode: string | null = null;
  const results = Array.isArray(env.results) ? env.results : [];
  for (const r of results) {
    const re = asObj(asObj(r).error);
    if (typeof re.code === 'string') {
      errorCode = re.code;
      break;
    }
  }
  if (!errorCode) {
    const topErr = asObj(env.error);
    if (typeof topErr.code === 'string') errorCode = topErr.code;
  }

  const cost = asObj(env.costSummary);
  const costUsd = typeof cost.totalActualCostUSD === 'number' ? cost.totalActualCostUSD : 0;

  const headline = typeof env.headline === 'string' ? env.headline : '';

  return { commit: { commitSha, commitSkipReason }, filesChanged, unresolved, errorCode, costUsd, headline };
}

export type ExecuteDisposition =
  | { kind: 'committed'; commitSha: string }
  | { kind: 'halt'; marker: string } // halt-for-decision (surface, don't push past)
  | { kind: 'failure'; reason: string }; // task failure (no_op / non-halt error)

/**
 * Classify the envelope into the executor's first disposition (before verify).
 *  - halt-for-decision: an error code in the halt set, OR empty filesChanged +
 *    non-empty unresolved (the "cannot implement as written" branch).
 *  - failure: a non-halt error code, or a no-op commit payload (no commitSha).
 *  - committed: a real commit SHA landed.
 */
export function classifyExecute(parsed: ParsedExecuteEnvelope): ExecuteDisposition {
  // Halt branch (a): an enumerated halt error code.
  if (parsed.errorCode && HALT_ERROR_CODES.has(parsed.errorCode)) {
    return { kind: 'halt', marker: `worker could not produce a committable result (${parsed.errorCode})` };
  }
  // Halt branch (b): the worker reports it cannot implement the task as written.
  if (parsed.filesChanged.length === 0 && parsed.unresolved.length > 0) {
    return { kind: 'halt', marker: parsed.unresolved.join(' · ') };
  }
  // A non-halt structured error → task failure.
  if (parsed.errorCode) {
    return { kind: 'failure', reason: `task error: ${parsed.errorCode}` };
  }
  // No commit payload → the falsely-not-implemented trap → verification failure.
  if (!parsed.commit.commitSha) {
    return {
      kind: 'failure',
      reason: parsed.commit.commitSkipReason
        ? `no commit (${parsed.commit.commitSkipReason})`
        : 'no commit payload',
    };
  }
  return { kind: 'committed', commitSha: parsed.commit.commitSha };
}
