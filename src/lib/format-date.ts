/**
 * Centralized date formatting — Asia/Singapore timezone, consistent across
 * server and client. Every date display in the product uses these functions.
 *
 * All functions accept Date | string | number and handle invalid input gracefully.
 */

const TZ = 'Asia/Singapore';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(input: Date | string | number): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

function sgtParts(d: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/**
 * Absolute date in SGT: "Jun 9, 2026"
 */
export function formatDate(input: Date | string | number): string {
  const d = toDate(input);
  if (!d) return String(input);
  const p = sgtParts(d);
  return `${MONTHS[p.month - 1]} ${p.day}, ${p.year}`;
}

/**
 * Date + time in SGT: "01 Jul 2026, 08:04"
 */
export function formatDateTime(input: Date | string | number): string {
  const d = toDate(input);
  if (!d) return String(input);
  const p = sgtParts(d);
  const dd = String(p.day).padStart(2, '0');
  const mm = String(p.minute).padStart(2, '0');
  const hh = String(p.hour).padStart(2, '0');
  return `${dd} ${MONTHS[p.month - 1]} ${p.year}, ${hh}:${mm}`;
}

/**
 * Time only in SGT: "08:04"
 */
export function formatTime(input: Date | string | number): string {
  const d = toDate(input);
  if (!d) return String(input);
  const p = sgtParts(d);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/**
 * ISO date in SGT: "2026-07-01"
 */
export function formatIsoDate(input: Date | string | number): string {
  const d = toDate(input);
  if (!d) return String(input);
  const p = sgtParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Frontmatter timestamp in SGT: "2026-07-01 08:04"
 */
export function formatTimestamp(input: Date | string | number): string {
  const d = toDate(input);
  if (!d) return String(input);
  const p = sgtParts(d);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  const hh = String(p.hour).padStart(2, '0');
  const mi = String(p.minute).padStart(2, '0');
  return `${p.year}-${mm}-${dd} ${hh}:${mi}`;
}

/**
 * Relative time: "just now", "5 min ago", "3 h ago", "7 d ago", or absolute date.
 */
export function formatRelative(when: Date | string | number, now: Date = new Date()): string {
  const d = toDate(when);
  if (!d) return String(when);
  const ms = now.getTime() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} d ago`;
  return formatDate(d);
}
