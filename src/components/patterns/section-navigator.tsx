'use client';

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * SectionNavigator — the governed single-section document navigator.
 *
 * A long reference document (the Direction manual, a handbook) reads best one
 * section at a time with a part-grouped index beside it and a stable deep link
 * per section. This component owns exactly that: the grouped anchor index, the
 * `#hash` ⇄ selected-section binding, and rendering the one selected record
 * through a child render prop.
 *
 * It is deliberately GENERIC (`T extends { id; part; title }`) and imports no
 * content or feature module, so it stays a reusable pattern rather than a
 * Direction-specific widget — the caller supplies both the records and the
 * ordered part headings.
 *
 * Hash contract:
 *   - a valid `#id` selects that section and is NEVER rewritten;
 *   - an empty or unknown hash falls back to `sections[0]` and normalizes the
 *     URL once via `history.replaceState`, so a bookmark always round-trips;
 *   - anchors are literal `<a href="#id">`, so browser back/forward keep working
 *     (no click interception).
 */
export interface SectionNavigatorProps<T> {
  /** Records in canonical source order; `sections[0]` is the fallback selection. */
  sections: readonly T[];
  /** Ordered group headings. A section is grouped under the part matching `section.part`. */
  parts: readonly { part: string; title: string }[];
  /** Renders the one selected record. */
  children: (section: T) => ReactNode;
  className?: string;
}

type SectionShape = { id: string; part: string; title: string };

/** The browser hash IS the selection state, so it is read as an external store
 *  rather than mirrored into React state — no effect-driven setState, and the
 *  server snapshot ('') keeps hydration stable. */
function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const readHash = () => window.location.hash;
const readServerHash = () => '';

export function SectionNavigator<T extends SectionShape>({
  sections,
  parts,
  children,
  className,
}: SectionNavigatorProps<T>) {
  // An empty document is an invalid caller contract, not a state to render: the
  // fallback selection would dereference an absent `sections[0]`. Fail loudly.
  if (sections.length === 0) {
    throw new Error('SectionNavigator requires a non-empty sections array');
  }
  return (
    <SectionNavigatorView sections={sections} parts={parts} className={className}>
      {children}
    </SectionNavigatorView>
  );
}

function SectionNavigatorView<T extends SectionShape>({
  sections,
  parts,
  children,
  className,
}: SectionNavigatorProps<T>) {
  const firstId = sections[0].id;
  const hash = useSyncExternalStore(subscribeToHash, readHash, readServerHash);
  const id = hash.replace(/^#/, '');
  const match = id ? sections.find((s) => s.id === id) : undefined;
  const selected = match ?? sections[0];

  // Only an EMPTY or UNKNOWN hash is normalized — a valid deep link is never
  // rewritten, so back/forward and bookmarks round-trip unchanged.
  useEffect(() => {
    if (!match) window.history.replaceState(null, '', `#${firstId}`);
  }, [match, firstId]);

  return (
    <div className={cn('grid grid-cols-1 items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]', className)}>
      <nav
        aria-label="Sections"
        className="flex flex-col gap-4 lg:sticky lg:top-2 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto"
      >
        {parts.map((part) => {
          const items = sections.filter((s) => s.part === part.part);
          if (items.length === 0) return null;
          return (
            <div key={part.part} className="flex flex-col gap-0.5">
              <span className="px-2 pb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-ink-faint">
                {part.title}
              </span>
              {items.map((s) => {
                const active = s.id === selected.id;
                return (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'rounded-[var(--r)] px-2 py-1 text-[0.8125rem] transition-colors',
                      active
                        ? 'bg-accent-tint font-medium text-accent-deep'
                        : 'text-ink-soft hover:bg-bg-sunk hover:text-ink',
                    )}
                  >
                    {s.title}
                  </a>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="min-w-0">{children(selected)}</div>
    </div>
  );
}
