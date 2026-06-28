/**
 * `deriveSummary` — derive `project.summary` from
 * `project.intent_md` by DETERMINISTIC truncation. NO LLM call (F1). The 120-char
 * boundary is sized to the single-line summary budget in `ProjectTopbar`/sidebar
 * (schema.md `project.summary`) — do not change without re-checking that UI.
 *
 * 1. Normalize: collapse internal whitespace runs to single spaces and trim.
 * 2. Short (≤120): store verbatim, no ellipsis.
 * 3. Long (>120): cut at the LAST ASCII space in head[0..120] (drop the space) +
 *    a single `…`; if head has no space, hard-cut at exactly 120 + `…`. Result is
 *    always ≤121 chars.
 */
export function deriveSummary(intentMd: string): string {
  const s = intentMd.replace(/\s+/g, ' ').trim();
  if (s.length <= 120) return s;

  const head = s.slice(0, 120);
  const lastSpace = head.lastIndexOf(' ');
  if (lastSpace >= 0) {
    return head.slice(0, lastSpace) + '…';
  }
  return head + '…';
}
