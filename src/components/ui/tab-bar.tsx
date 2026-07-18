'use client';

import { cn } from '@/lib/cn';

/**
 * TabBar — the segmented switcher that sits at the right of a panel header. Shared so the
 * toggle looks identical wherever it appears, whether or not the panel is a document:
 * `DocumentShell` uses it for Spec ⋅ Audit / Plan ⋅ Discussion, and Explore uses it for
 * Brain-dump ⋅ Tasks, which are plain Content-Shell panels rather than documents.
 *
 * Omit `onTabChange` for a read-only bar (the caller drives the active tab elsewhere).
 */
export interface TabBarTab {
  id: string;
  label: string;
}

export function TabBar({
  tabs,
  activeTab,
  onTabChange,
  className,
}: {
  tabs: readonly TabBarTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  className?: string;
}) {
  if (tabs.length === 0) return null;
  return (
    <div
      role="tablist"
      className={cn('flex items-center rounded-[var(--r)] border border-line bg-surface-2 p-0.5', className)}
    >
      {tabs.map((t) =>
        onTabChange ? (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => onTabChange(t.id)}
            className={cn(
              'rounded-[6px] px-3 py-1 text-xs font-medium transition-colors',
              activeTab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ) : (
          <span
            key={t.id}
            className={cn(
              'rounded-[6px] px-3 py-1 text-xs font-medium',
              activeTab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint',
            )}
          >
            {t.label}
          </span>
        ),
      )}
    </div>
  );
}
