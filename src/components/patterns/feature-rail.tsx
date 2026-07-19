import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Eyebrow } from '@/components/ui';
import { ProseBlock } from '@/components/patterns/prose-block';

export interface RailNoteProps {
  icon: ReactNode;
  title?: string;
  children: string;
  className?: string;
}

export function RailNote({ icon, title, children, className }: RailNoteProps) {
  return (
    // `items-start` deliberately: the note body runs to many lines, and an icon centred
    // against a long block would float in the middle of the paragraph.
    // `data-rail-note` marks this as GUIDANCE, not a panel. The Content Shell fills its
    // rail's last child so the right panel reaches the bottom; a note must never be that
    // child — stretched, it becomes a huge tinted block of empty space under three lines
    // of text. It always wraps its own content.
    <div
      data-rail-note
      className={cn('flex shrink-0 items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/40 px-4 py-4', className)}
    >
      <span
        aria-hidden
        className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-tint text-accent [&>svg]:size-5"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        {title ? <Eyebrow as="h3" className="mb-2 text-ink">{title}</Eyebrow> : null}
        <ProseBlock variant="rail">{children}</ProseBlock>
      </div>
    </div>
  );
}
