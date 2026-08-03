import type { LoopRunStatus } from '@/db/enums';
import { formatDateTime } from '@/lib/format-date';
import { parseLlmJson } from '@/lib/llm-json';

/**
 * Badge tint per run status. Keyed by `LoopRunStatus`, not `string`: as a loose record a
 * new status compiled fine and rendered with no tint.
 */
export const RUN_STATUS_VARIANT: Record<LoopRunStatus, 'sage' | 'rose' | 'steel' | 'neutral'> = {
  changed: 'sage',
  failed: 'rose',
  running: 'steel',
  no_changes: 'neutral',
};

/**
 * Human label per run status. The rule below it — "never expose raw enum values like
 * `no_changes`" — was enforced by nothing: as `Record<string, string>` a new status fell
 * through `statusLabel`'s `?? s` and the user saw the enum value. Total over the enum now,
 * so adding one fails the build here instead.
 */
export const RUN_STATUS_LABEL: Record<LoopRunStatus, string> = {
  changed: 'Changed',
  failed: 'Failed',
  running: 'Running',
  no_changes: 'No changes',
};

/*
 * Both accessors take `string` — callers read the status off a DB row, where Drizzle types
 * the column loosely. The records above are TOTAL over the enum, so these fallbacks only
 * fire for a value that is not a run status at all, rather than papering over a status
 * somebody forgot to add.
 */

/** Human label per run status. */
export const statusLabel = (s: string): string => RUN_STATUS_LABEL[s as LoopRunStatus] ?? s;

/** Badge tint per run status. The three badge sites each wrote `MAP[x] ?? 'neutral'`. */
export const statusVariant = (s: string): 'sage' | 'rose' | 'steel' | 'neutral' =>
  RUN_STATUS_VARIANT[s as LoopRunStatus] ?? 'neutral';

/** Capitalize the first letter — for short tokens like the trigger. */
export const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function fmtRunTime(v: string | Date | null): string {
  if (!v) return '—';
  return formatDateTime(v);
}

/** Human duration between two timestamps, or '—' if either is missing. */
export function fmtDuration(start: string | Date | null, end: string | Date | null): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Unwrap a change line stored as a raw worker JSON report (bare or ```json-fenced) to its prose summary. */
export function cleanChange(c: string): string {
  const p = parseLlmJson<{ summary?: unknown }>(c);
  return p && typeof p.summary === 'string' && p.summary.trim() ? p.summary : c;
}

export const shortId = (id: string): string => id.slice(0, 8);
