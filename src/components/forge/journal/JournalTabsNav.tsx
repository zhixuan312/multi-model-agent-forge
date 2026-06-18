import Link from 'next/link';
import { BookOpen, Hexagon, Share2, History } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The Journal tab bar — lives in the PageFrame header sub-nav (like SettingsTabs),
 * Link-based so each view is a real navigation. Server component; the active tab
 * is passed in. Order: Recall · Nodes · Graph · Log.
 */
export type JournalView = 'recall' | 'nodes' | 'graph' | 'log';

const TABS: ReadonlyArray<{ key: JournalView; label: string; glyph: React.ReactNode }> = [
  { key: 'recall', label: 'Recall', glyph: <BookOpen className="size-4" /> },
  { key: 'nodes', label: 'Nodes', glyph: <Hexagon className="size-4" /> },
  { key: 'graph', label: 'Graph', glyph: <Share2 className="size-4" /> },
  { key: 'log', label: 'Log', glyph: <History className="size-4" /> },
];

export function JournalTabsNav({ active }: { active: JournalView }) {
  return (
    <div role="tablist" aria-label="Journal views" className="flex gap-1 border-b border-line">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/journal?view=${tab.key}`}
          role="tab"
          aria-selected={active === tab.key}
          aria-current={active === tab.key ? 'page' : undefined}
          className={cn(
            'focus-ring -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors',
            active === tab.key
              ? 'border-accent font-medium text-ink'
              : 'border-transparent text-ink-soft hover:text-ink',
          )}
        >
          <span aria-hidden className="inline-flex">
            {tab.glyph}
          </span>
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
