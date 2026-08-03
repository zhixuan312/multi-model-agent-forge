import type { MemberRef } from './types';

/**
 * @-mention resolution — the one implementation.
 *
 * Answers "which member does this `@…` name, and where is it?" for the discussion thread,
 * which highlights the mention in the rendered bubble.
 *
 * It used to answer that for a second surface too: a `parseMentions` that turned a submitted
 * message into co-approval participants. Nothing called it. Participation comes from the
 * explicit Invite picker (`/api/projects/:id/spec/invite`), and @-mentioning a teammate
 * neither adds them nor notifies them — only `@Forge` (`spec/forge-mention.ts`) carries
 * behaviour. The docstring here described that wiring as if it existed, which is worse than
 * silence: it says the feature is covered.
 *
 * The rules below still earn their keep — the renderer had its own regex once, and it was
 * case-sensitive with no trailing boundary, so `@bo chen` highlighted nothing and `@Bobby`
 * highlighted its `@Bo` prefix when a "Bo" was in the pool.
 *
 * Three rules, applied once here:
 *   - Longest display name wins, so `@Bo Chen` is Bo Chen and never also a shorter `Bo`.
 *   - A matched range is consumed, so no two mentions can overlap the same characters.
 *   - Case-insensitive, with a trailing `(?!\w)` guard so `@Bo` does not match inside
 *     `@Bobby`. The guard is load-bearing; without it the longest-first rule is not enough.
 */
export interface MentionSpan {
  /** Index of the `@` in the source text. */
  start: number;
  /** Exclusive end index. */
  end: number;
  /** The literal matched text, e.g. `"@Bo Chen"` — preserves the author's casing. */
  text: string;
  member: MemberRef;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every resolvable `@`-mention in `text`, in the order they appear. Unresolvable `@text` is
 * ignored (never throws). A member may appear more than once if mentioned more than once.
 */
export function mentionSpans(text: string, pool: MemberRef[]): MentionSpan[] {
  const byLen = [...pool]
    .filter((m) => m.displayName.length > 0)
    .sort((a, b) => b.displayName.length - a.displayName.length);

  const spans: MentionSpan[] = [];
  const taken = new Array<boolean>(text.length).fill(false);

  for (const m of byLen) {
    const re = new RegExp(`@${escapeRegExp(m.displayName)}(?!\\w)`, 'gi');
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(text)) !== null) {
      const start = hit.index;
      const end = start + hit[0].length;
      // A longer name already claimed these characters — skip, don't double-count.
      let free = true;
      for (let i = start; i < end; i++) {
        if (taken[i]) { free = false; break; }
      }
      if (!free) continue;
      for (let i = start; i < end; i++) taken[i] = true;
      spans.push({ start, end, text: hit[0], member: m });
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}

