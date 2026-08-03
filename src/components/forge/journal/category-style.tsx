import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { LearningCategory } from '@/journal/types';

/**
 * The tint for a learning category chip.
 *
 * This map existed three times — in JournalStageClient, NodeDetail and NodesView — and two
 * of the copies carried a comment saying they "mirror" the first. A comment that documents
 * a duplication is not a fix; it just records which copy to update by hand.
 *
 * `node.type` on a journal node comes from frontmatter on disk, so it is an arbitrary
 * string, not a `LearningCategory`. Use `categoryStyle` rather than indexing directly: an
 * unrecognised category previously produced `undefined` and rendered an unstyled chip
 * (invisible padding, no background), where it now falls back to the neutral tint.
 */
const CATEGORY_STYLE: Record<LearningCategory, string> = {
  decision: 'bg-accent-tint text-accent',
  design: 'bg-[var(--frost)] text-[var(--steel)]',
  behavior: 'bg-sage-tint text-[var(--sage-deep)]',
  process: 'bg-amber-tint text-[var(--amber)]',
  knowledge: 'bg-rose-tint text-[var(--rose)]',
  style: 'bg-surface-2 text-ink-soft',
};

/** Neutral tint, also used for anything outside the taxonomy. */
const NEUTRAL = CATEGORY_STYLE.style;

export function categoryStyle(category: string | null | undefined): string {
  if (!category) return NEUTRAL;
  return CATEGORY_STYLE[category as LearningCategory] ?? NEUTRAL;
}

/**
 * The category pill. The MAP was extracted here after existing three times; the MARKUP
 * that renders it stayed duplicated in `NodeDetail` and `JournalStageClient` — the same
 * five utilities written out twice, either of which could have drifted.
 */
export function CategoryChip({
  category,
  size = 'md',
  className,
}: {
  category: ReactNode;
  /** `sm` is the compact list-row pill; `md` the document header pill. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'rounded-full font-semibold',
        size === 'sm' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px] uppercase tracking-wide',
        categoryStyle(typeof category === 'string' ? category : null),
        className,
      )}
    >
      {category}
    </span>
  );
}
