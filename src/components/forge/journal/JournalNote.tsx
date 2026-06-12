import { BookText } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Markdown } from '@/components/forge/Markdown';

/**
 * JournalNote — the rail note for the Journal page (the read-only counterpart to
 * SettingsAccessNote). It explains what the decision graph is and that it is
 * recorded by MMA, not edited here. Shown in the 1/3 rail whenever the rail isn't
 * occupied by a selected node's detail.
 */
const JOURNAL_MD = `**Read-only decision graph**

Each node is one decision the team reached — its crux, why, and the consequence. The status tells you whether it still holds:

- \`adopted\` — a live learning
- \`superseded\` — replaced by a newer node
- \`dropped\` · \`inconclusive\` — abandoned or unresolved

Edges link refinements and supersessions. Entries are written by MMA at project freeze — there's no editing here.`;

/** Compact prose tuned for the small rail note box (mirrors SettingsAccessNote). */
const NOTE_PROSE =
  'min-w-0 ' +
  'prose-p:my-1.5 prose-p:text-xs prose-p:leading-relaxed prose-p:text-ink-soft ' +
  'prose-strong:text-ink prose-strong:font-semibold ' +
  'prose-ul:my-1.5 prose-ul:pl-4 prose-ul:list-disc ' +
  'prose-li:my-0.5 prose-li:text-xs prose-li:text-ink-soft prose-li:marker:text-accent ' +
  'prose-hr:my-3 prose-hr:border-accent-tint ' +
  'prose-code:rounded prose-code:bg-accent-tint/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.7rem] ' +
  'prose-code:font-medium prose-code:text-accent-deep prose-code:before:content-none prose-code:after:content-none';

export function JournalNote() {
  return (
    <div className="flex items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/40 px-4 py-4">
      <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-tint text-accent">
        <BookText className="size-5" />
      </span>
      <Markdown className={cn(NOTE_PROSE)}>{JOURNAL_MD}</Markdown>
    </div>
  );
}
