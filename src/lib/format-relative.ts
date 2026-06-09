/**
 * `formatRelative` (Spec 3 flow 2, pinned contract) — a human relative time for
 * the project-card footer:
 *   < 60s  → "just now"
 *   < 60min → "N min ago"
 *   < 24h  → "N h ago"
 *   < 30d  → "N d ago"
 *   ≥ 30d  → an absolute date "MMM D, YYYY"
 * `now` is injectable so a card-render test can pin the string deterministically.
 */
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function formatRelative(when: Date, now: Date = new Date()): string {
  const ms = now.getTime() - when.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} d ago`;
  return `${MONTHS[when.getMonth()]} ${when.getDate()}, ${when.getFullYear()}`;
}
