import type { MemberRef } from './types';

/**
 * @-mention resolution — the one implementation.
 *
 * Two surfaces need the same answer to "which member does this `@…` name?": the composer,
 * which turns a submitted message into co-approval participants, and the discussion thread,
 * which highlights the mention in the rendered bubble. They had a regex each, and the two
 * disagreed — the renderer was case-sensitive and had no trailing boundary, so `@bo chen`
 * highlighted nothing that the participant resolver happily resolved, and `@Bobby`
 * highlighted its `@Bo` prefix when a "Bo" was in the pool.
 *
 * `mentionSpans` is the shared core: it reports WHERE each mention is and WHO it resolves
 * to, which is enough to drive both jobs.
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

/**
 * The distinct members mentioned in `text`, in the order they first appear. Drives
 * co-approval: mentioning someone adds them as a participant.
 */
export function parseMentions(text: string, pool: MemberRef[]): MemberRef[] {
  const seen = new Set<string>();
  const out: MemberRef[] = [];
  for (const s of mentionSpans(text, pool)) {
    if (seen.has(s.member.id)) continue;
    seen.add(s.member.id);
    out.push(s.member);
  }
  return out;
}
