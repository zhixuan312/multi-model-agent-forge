'use client';

import { formatCost, formatDuration } from '@/usage/format';

/**
 * The cell renderers the four usage tables share.
 *
 * `taskCount`, `costUsd`, `savedUsd`, `avgCostUsd` and `durationMs` appeared across
 * StandaloneUsageTable, UsageBatchTable, ProjectUsageTable and LoopUsageTable as seventeen
 * byte-identical `cell:` closures. The formatting and the styling are one decision each —
 * `tabular-nums` so figures align down a column, and the sage token that marks money saved
 * — and holding them in seventeen places means a change to either lands in some tables and
 * not others, which reads as a data discrepancy rather than a styling slip.
 *
 * Deliberately NOT whole column definitions. `header` and `size` differ on purpose between
 * these tables ("Count" vs "Tasks", "Agent time" vs "Agent hours", "Avg/question" vs
 * "Avg/task"), and unifying those would flatten wording each page chose for its own
 * audience. Extract what must not drift; leave what should vary.
 */
export function NumCell({ value }: { value: number | null | undefined }) {
  return <span className="tabular-nums">{value}</span>;
}

export function CostCell({ value }: { value: number | null | undefined }) {
  return <span className="tabular-nums">{formatCost(value ?? null)}</span>;
}

/** Money saved reads as a positive, so it carries the sage token — one definition of it. */
export function SavedCell({ value }: { value: number | null | undefined }) {
  return <span className="tabular-nums text-[var(--sage)]">{formatCost(value || null)}</span>;
}

export function DurationCell({ value }: { value: number | null | undefined }) {
  return <span className="tabular-nums">{formatDuration(value ?? 0)}</span>;
}
