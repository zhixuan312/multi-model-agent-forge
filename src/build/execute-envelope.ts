/**
 * Pure interpretation of the MMA `execute-plan` terminal envelope (v5.4+).
 * No DB, no git, no network.
 *
 * The new terminal response shape:
 *   { task: { taskId, type, status },
 *     output: { summary, filesChanged, contextBlockId },
 *     execution: { sessions, worktree: { merged, branch, path? } | null },
 *     metrics: { totalDurationMs, totalCostUsd, ... },
 *     raw: { implementer, reviewer },
 *     error: { code, message } | null }
 *
 * Fields this module reads:
 *   - `task.status`                  — 'done' | 'done_with_concerns' | 'failed'
 *   - `output.summary`              — parsed worker output (may contain commitSha)
 *   - `output.filesChanged`         — string[] of changed file paths
 *   - `execution.worktree.branch`   — the worktree branch name
 *   - `execution.worktree.merged`   — whether the worktree was merged back
 *   - `metrics.totalCostUsd`        — for the running-cost tick
 *   - `error.code`                  — the structured error code
 */

export const HALT_ERROR_CODES = new Set([
  'validator_silent_incomplete',
  'validator_no_artifacts',
  'lifecycle_review_loop_capped',
  'validator_dirty_worktree',
  'validator_no_changes',
]);

export interface CommitPayload {
  commitSha: string | null;
  commitSkipReason: string | null;
}

export interface ParsedExecuteEnvelope {
  commit: CommitPayload;
  filesChanged: string[];
  unresolved: string[];
  errorCode: string | null;
  costUsd: number;
  headline: string;
  worktreeBranch: string | null;
  worktreeMerged: boolean;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

export function parseExecuteEnvelope(envelope: unknown): ParsedExecuteEnvelope {
  const env = asObj(envelope);
  const task = asObj(env.task);
  const output = asObj(env.output);
  const execution = asObj(env.execution);
  const metrics = asObj(env.metrics);
  const error = env.error ? asObj(env.error) : null;
  const worktree = execution.worktree ? asObj(execution.worktree) : null;

  // Extract commit info from output.summary (worker JSON output may contain commitSha)
  const summary = output.summary;
  const summaryObj = summary && typeof summary === 'object' ? asObj(summary) : {};
  const commitSha = typeof summaryObj.commitSha === 'string' && summaryObj.commitSha.length > 0
    ? summaryObj.commitSha
    : null;
  const commitSkipReason = typeof summaryObj.commitSkipReason === 'string' && summaryObj.commitSkipReason.length > 0
    ? summaryObj.commitSkipReason
    : null;

  const filesChanged = Array.isArray(output.filesChanged)
    ? (output.filesChanged as unknown[]).filter((f): f is string => typeof f === 'string')
    : [];

  const unresolved = Array.isArray(summaryObj.unresolved)
    ? (summaryObj.unresolved as unknown[]).filter((u): u is string => typeof u === 'string')
    : [];

  const errorCode = error && typeof error.code === 'string' ? error.code : null;
  const costUsd = typeof metrics.totalCostUsd === 'number' ? metrics.totalCostUsd : 0;

  const status = typeof task.status === 'string' ? task.status : '';
  const headline = status === 'failed' ? 'failed' : 'done';

  return {
    commit: { commitSha, commitSkipReason },
    filesChanged,
    unresolved,
    errorCode,
    costUsd,
    headline,
    worktreeBranch: worktree && typeof worktree.branch === 'string' ? worktree.branch : null,
    worktreeMerged: worktree ? worktree.merged === true : false,
  };
}

export type ExecuteDisposition =
  | { kind: 'committed'; commitSha: string }
  | { kind: 'halt'; marker: string }
  | { kind: 'failure'; reason: string };

export function classifyExecute(parsed: ParsedExecuteEnvelope): ExecuteDisposition {
  if (parsed.errorCode && HALT_ERROR_CODES.has(parsed.errorCode)) {
    return { kind: 'halt', marker: `worker could not produce a committable result (${parsed.errorCode})` };
  }
  if (parsed.filesChanged.length === 0 && parsed.unresolved.length > 0) {
    return { kind: 'halt', marker: parsed.unresolved.join(' · ') };
  }
  if (parsed.errorCode) {
    return { kind: 'failure', reason: `task error: ${parsed.errorCode}` };
  }
  // With worktree-based execution, "committed" means the worktree was merged.
  // The old commitSha from worker self-commit may not exist; the worktree merge IS the commit.
  if (parsed.worktreeMerged) {
    return { kind: 'committed', commitSha: parsed.commit.commitSha ?? 'worktree-merged' };
  }
  if (parsed.commit.commitSha) {
    return { kind: 'committed', commitSha: parsed.commit.commitSha };
  }
  return {
    kind: 'failure',
    reason: parsed.commit.commitSkipReason
      ? `no commit (${parsed.commit.commitSkipReason})`
      : 'no commit payload and worktree not merged',
  };
}
