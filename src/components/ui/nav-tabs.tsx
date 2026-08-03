import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * NavTabs — the underlined page sub-nav that sits in a PageFrame header.
 *
 * Five of these existed (journal, loops, usage, org settings, team settings), each with
 * the same tablist wrapper, the same Link, the same three aria attributes and the same
 * forty-character class string; several carried a comment noting they matched one of the
 * others. Differences were confined to the tab list itself.
 *
 * Distinct from `TabBar`, which is the segmented pill switcher inside a panel header.
 * These are real navigation — each tab is a link to its own page — so they must stay
 * `Link`-based and keep `aria-current="page"`. The two are not interchangeable.
 *
 * Deliberately NOT a client component: every caller is a server component that passes the
 * active tab in, and adding `'use client'` would pull the whole sub-nav into the browser
 * bundle for no behaviour.
 */
export interface NavTab {
  /** Identifies the tab; compared against `active`. */
  key: string;
  label: string;
  href: string;
  /** Decorative — always rendered `aria-hidden`, the label carries the meaning. */
  glyph?: React.ReactNode;
}

export function NavTabs({
  tabs,
  active,
  label,
  className,
}: {
  tabs: readonly NavTab[];
  active: string;
  /** Accessible name for the tablist, e.g. "Journal views". */
  label: string;
  className?: string;
}) {
  if (tabs.length === 0) return null;
  return (
    <div role="tablist" aria-label={label} className={cn('flex gap-1 border-b border-line', className)}>
      {tabs.map((tab) => {
        const selected = active === tab.key;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            role="tab"
            aria-selected={selected}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'focus-ring -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors',
              selected ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-soft hover:text-ink',
            )}
          >
            {tab.glyph ? (
              <span aria-hidden className="inline-flex">
                {tab.glyph}
              </span>
            ) : null}
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
