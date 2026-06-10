import { type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Breadcrumb — the header's left-zone wayfinding trail. Renders an ordered list
 * of crumbs separated by chevrons; the final crumb is the current page
 * (`aria-current`, non-link). Crumbs with `href` are links back up the tree.
 *
 *   <Breadcrumb items={[{ label: 'Projects', href: '/projects' }, { label: 'New project' }]} />
 */
export interface Crumb {
  label: ReactNode;
  href?: string;
}

export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="t-micro flex min-w-0 items-center gap-1 text-ink-faint">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex min-w-0 items-center gap-1">
              {c.href && !last ? (
                <Link
                  href={c.href}
                  className="shrink-0 rounded-sm transition-colors duration-150 ease-[var(--ease-out)] hover:text-ink focus-ring"
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={cn('truncate', last && 'text-ink-soft')}
                >
                  {c.label}
                </span>
              )}
              {last ? null : <ChevronRight className="size-3 shrink-0 text-ink-faint/60" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
