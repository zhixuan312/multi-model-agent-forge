import { Cron } from 'croner';

/**
 * Cron helpers for Loops (see spec §5). `croner` is the single cron engine — it
 * validates expressions and computes next-run times (used by the create/edit
 * "next 3 runs" preview and the scheduler's due check).
 *
 * All Forge projects run in Singapore time, so loop cron expressions are
 * interpreted in `Asia/Singapore` (deterministic across the scheduler + preview).
 */
export const LOOP_TIMEZONE = 'Asia/Singapore';

/** True iff `expr` is a valid standard cron expression. */
export function isValidCron(expr: string): boolean {
  const trimmed = expr.trim();
  if (trimmed === '') return false;
  try {
    new Cron(trimmed);
    return true;
  } catch {
    return false;
  }
}

const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const hhmm = (h: string, m: string) => `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;

/**
 * A human, professional description of a standard 5-field cron expression for
 * display (e.g. "Daily at 03:00", "Every 15 minutes", "Mondays at 09:00").
 * Falls back to the raw expression for anything it doesn't recognise.
 */
export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr.trim();
  const [min, hr, dom, mon, dow] = parts;
  const num = (s: string) => /^\d+$/.test(s);
  const wild = dom === '*' && mon === '*';

  const everyMin = min.match(/^\*\/(\d+)$/);
  if (everyMin && hr === '*' && wild && dow === '*') return `Every ${everyMin[1]} minutes`;
  if (min === '*' && hr === '*' && wild && dow === '*') return 'Every minute';

  const everyHr = hr.match(/^\*\/(\d+)$/);
  if (num(min) && everyHr && wild && dow === '*') return `Every ${everyHr[1]} hours`;
  if (num(min) && hr === '*' && wild && dow === '*') return min === '0' ? 'Hourly' : `Hourly at :${min.padStart(2, '0')}`;

  if (num(min) && num(hr) && wild) {
    const at = hhmm(hr, min);
    if (dow === '*') return `Daily at ${at}`;
    if (dow === '1-5') return `Weekdays at ${at}`;
    if (/^[0-6]$/.test(dow)) return `${DAY_NAMES[Number(dow)]} at ${at}`;
  }
  return expr.trim();
}

/** The next `count` run times strictly after `from` (default: now). `[]` if invalid. */
export function nextRuns(expr: string, count: number, from: Date = new Date()): Date[] {
  if (!isValidCron(expr)) return [];
  const cron = new Cron(expr.trim(), { timezone: LOOP_TIMEZONE });
  const out: Date[] = [];
  let cursor: Date | null = from;
  for (let i = 0; i < count; i += 1) {
    cursor = cron.nextRun(cursor ?? undefined);
    if (!cursor) break;
    out.push(cursor);
  }
  return out;
}
