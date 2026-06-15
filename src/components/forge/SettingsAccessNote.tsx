import { type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Markdown } from '@/components/forge/Markdown';

/**
 * SettingsAccessNote — the rail note shown at the top of a Team Settings tab.
 * Each tab supplies its OWN note: a markdown `body` describing what that tab is
 * for, plus an optional `icon` (defaults to a shield). There is no shared
 * boilerplate — every tab's note stands on its own. Rendered as markdown so the
 * notes read as proper prose (lists / bold / inline code).
 */

/** Compact prose tuned for the small rail note box. */
const NOTE_PROSE =
  'min-w-0 ' +
  'prose-headings:mt-0 prose-headings:mb-2 prose-h3:text-sm prose-h3:font-semibold prose-h3:text-ink ' +
  'prose-p:my-1.5 prose-p:text-xs prose-p:leading-relaxed prose-p:text-ink-soft ' +
  'prose-strong:text-ink prose-strong:font-semibold ' +
  'prose-ul:my-1.5 prose-ul:pl-4 prose-ul:list-disc ' +
  'prose-li:my-0.5 prose-li:text-xs prose-li:text-ink-soft prose-li:marker:text-accent ' +
  'prose-hr:my-3 prose-hr:border-accent-tint ' +
  'prose-code:rounded prose-code:bg-accent-tint/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.7rem] ' +
  'prose-code:font-medium prose-code:text-accent-deep prose-code:before:content-none prose-code:after:content-none';

export function SettingsAccessNote({ body, icon }: { body: string; icon?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/40 px-4 py-4">
      <span
        aria-hidden
        className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-tint text-accent [&>svg]:size-5"
      >
        {icon ?? <ShieldCheck />}
      </span>
      <Markdown className={cn(NOTE_PROSE)}>{body}</Markdown>
    </div>
  );
}
