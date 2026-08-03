import { BookOpen, Hexagon, Share2, History } from 'lucide-react';
import { NavTabs } from '@/components/ui/nav-tabs';

/**
 * The Journal tab bar — the PageFrame header sub-nav, rendered by the shared `NavTabs`,
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
  const tabs = TABS.map((t) => ({ ...t, href: `/journal?view=${t.key}` }));
  return <NavTabs tabs={tabs} active={active} label="Journal views" />;
}
