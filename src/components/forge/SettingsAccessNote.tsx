import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Markdown } from '@/components/forge/Markdown';

/**
 * SettingsAccessNote — the single rail note shown at the top of every Team
 * Settings tab. It always carries the team access-model reminder; an optional
 * `body` (markdown) is appended below a divider, so each tab shows exactly ONE
 * note box. Content is rendered as markdown (lists / bold / inline code) so the
 * notes read as proper descriptive prose, not cramped sentences.
 */
const ACCESS_MD = `**Equal rights, admin capability**

All members can create projects, answer Q&A, run stages, and collaborate. Admins can manage providers, roster, connections, members, and repo cloning.`;

/** Compact prose tuned for the small rail note box. */
const NOTE_PROSE =
  'min-w-0 ' +
  'prose-p:my-1.5 prose-p:text-xs prose-p:leading-relaxed prose-p:text-ink-soft ' +
  'prose-strong:text-ink prose-strong:font-semibold ' +
  'prose-ul:my-1.5 prose-ul:pl-4 prose-ul:list-disc ' +
  'prose-li:my-0.5 prose-li:text-xs prose-li:text-ink-soft prose-li:marker:text-accent ' +
  'prose-hr:my-3 prose-hr:border-accent-tint ' +
  'prose-code:rounded prose-code:bg-accent-tint/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.7rem] ' +
  'prose-code:font-medium prose-code:text-accent-deep prose-code:before:content-none prose-code:after:content-none';

export function SettingsAccessNote({ body }: { body?: string }) {
  const md = body ? `${ACCESS_MD}\n\n---\n\n${body}` : ACCESS_MD;
  return (
    <div className="flex items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/40 px-4 py-4">
      <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-tint text-accent">
        <ShieldCheck className="size-5" />
      </span>
      <Markdown className={cn(NOTE_PROSE)}>{md}</Markdown>
    </div>
  );
}
