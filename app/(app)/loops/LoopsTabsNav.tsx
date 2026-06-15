import Link from 'next/link';
import { Repeat, History } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Loops tab bar — lives in the PageFrame header sub-nav (mirrors JournalTabsNav).
 * Link-based so each tab is a real page: Loops (the management table) and Run
 * history (the runs/transactions). Server component; active tab passed in.
 */
export type LoopsView = 'loops' | 'history';

const TABS: ReadonlyArray<{ key: LoopsView; label: string; href: string; glyph: React.ReactNode }> = [
  { key: 'loops', label: 'Loops', href: '/loops', glyph: <Repeat className="size-4" /> },
  { key: 'history', label: 'Activities', href: '/loops/activity', glyph: <History className="size-4" /> },
];

export function LoopsTabsNav({ active }: { active: LoopsView }) {
  return (
    <div role="tablist" aria-label="Loops views" className="flex gap-1 border-b border-line">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          role="tab"
          aria-selected={active === tab.key}
          aria-current={active === tab.key ? 'page' : undefined}
          className={cn(
            'focus-ring -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors',
            active === tab.key ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-soft hover:text-ink',
          )}
        >
          <span aria-hidden className="inline-flex">{tab.glyph}</span>
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
