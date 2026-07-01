import { LOOP_TIMEZONE } from '@/loops/cron';

/** Badge tint per run status. */
export const RUN_STATUS_VARIANT: Record<string, 'sage' | 'rose' | 'steel' | 'neutral'> = {
  changed: 'sage',
  failed: 'rose',
  running: 'steel',
  no_changes: 'neutral',
};

/** Human label per run status (never expose raw enum values like `no_changes`). */
export const RUN_STATUS_LABEL: Record<string, string> = {
  changed: 'Changed',
  failed: 'Failed',
  running: 'Running',
  no_changes: 'No changes',
};

export const statusLabel = (s: string): string => RUN_STATUS_LABEL[s] ?? s;

/** Capitalize the first letter — for short tokens like the trigger. */
export const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

import { formatDateTime } from '@/lib/format-date';

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
  const fence = c.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  const body = (fence ? fence[1] : c).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return c;
  try {
    const p = JSON.parse(body.slice(start, end + 1)) as { summary?: unknown };
    return typeof p.summary === 'string' && p.summary.trim() ? p.summary : c;
  } catch {
    return c;
  }
}

export const shortId = (id: string): string => id.slice(0, 8);
