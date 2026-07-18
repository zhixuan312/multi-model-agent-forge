'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, Eyebrow } from '@/components/ui';

/**
 * List — the shared left-panel list container: a card holding one or more sections, each an
 * optional `header` (Eyebrow) over `divide-y` rows. Each row has a leading slot (icon), primary
 * (+ optional secondary) text, and a trailing slot (badge / count).
 *
 * A row is EXPANDABLE when it carries a `body`: the whole row becomes a button with a left-side
 * chevron (the "Expand arrow" affordance) that rotates open to reveal `body` inline — the
 * governed behaviour every expandable list shares (e.g. the Journal recall panel: question in
 * the row, answer in the body). A row with `onClick` but no `body` is a plain action/navigate
 * row; a row with neither is passive. Content-agnostic — callers pass what fills the slots and
 * the body; the container + expand behaviour is what's governed.
 */
export interface ListRow {
  id: string;
  /** Optional leading icon, shown after the expand chevron. */
  leading?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
  /** When present, the row is expandable — the chevron toggles this content open/closed. */
  body?: ReactNode;
  /** Start expanded (e.g. the item the user just acted on). Only applies with `body`. */
  defaultOpen?: boolean;
  /** Row click for a non-expandable (navigate / action) row. Ignored when `body` is set. */
  onClick?: () => void;
}

export interface ListSection {
  /** Stable identity for the section. Set it whenever sections can be added/removed/reordered
   *  (e.g. a section that appears only when non-empty) so React doesn't remount a surviving
   *  section — which would lose its rows' expand state. Falls back to the array index. */
  id?: string;
  header?: ReactNode;
  rows: readonly ListRow[];
}

export function List({ sections, className }: { sections: readonly ListSection[]; className?: string }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // Open any expandable row that appears with `defaultOpen` — on first mount AND when a new
  // one arrives later (e.g. a just-run item lands in the list). `seen` guards each id so a
  // row the user manually collapsed is never force-reopened on a later render.
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    const toOpen: string[] = [];
    for (const section of sections) {
      for (const row of section.rows) {
        if (row.body != null && row.defaultOpen && !seen.current.has(row.id)) toOpen.push(row.id);
        seen.current.add(row.id);
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- open newly-appeared defaultOpen rows once; guarded by `seen` so it can't loop or re-open a manually-closed row
    if (toOpen.length) setOpen((prev) => new Set([...prev, ...toOpen]));
  }, [sections]);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-4 py-4">
        {sections.map((section, i) => (
          <section key={section.id ?? i} className="flex flex-col gap-2">
            {section.header ? <Eyebrow className="text-ink-faint">{section.header}</Eyebrow> : null}
            <ul className="flex flex-col divide-y divide-line">
              {section.rows.map((row) => {
                const expandable = row.body != null;
                const isOpen = expandable && open.has(row.id);
                const interactive = expandable || row.onClick != null;
                const inner = (
                  <>
                    {expandable ? (
                      <ChevronRight
                        className={cn('size-4 shrink-0 text-ink-faint transition-transform', isOpen && 'rotate-90')}
                      />
                    ) : null}
                    {row.leading}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">{row.primary}</p>
                      {row.secondary ? <p className="text-xs text-ink-faint">{row.secondary}</p> : null}
                    </div>
                    {row.trailing}
                  </>
                );
                return (
                  <li key={row.id}>
                    {interactive ? (
                      <button
                        type="button"
                        onClick={() => (expandable ? toggle(row.id) : row.onClick?.())}
                        aria-expanded={expandable ? isOpen : undefined}
                        className="focus-ring flex w-full items-center gap-3 py-3 text-left text-sm"
                      >
                        {inner}
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 py-3 text-sm">{inner}</div>
                    )}
                    {isOpen ? <div className="pb-3 pl-7">{row.body}</div> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
