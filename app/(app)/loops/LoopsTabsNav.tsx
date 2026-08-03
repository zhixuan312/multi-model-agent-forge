import { Repeat, History } from 'lucide-react';
import { NavTabs } from '@/components/ui/nav-tabs';

/**
 * Loops tab bar — the PageFrame header sub-nav, rendered by the shared `NavTabs`.
 * Link-based so each tab is a real page: Loops (the management table) and Run
 * history (the runs/transactions). Server component; active tab passed in.
 */
export type LoopsView = 'loops' | 'history';

const TABS: ReadonlyArray<{ key: LoopsView; label: string; href: string; glyph: React.ReactNode }> = [
  { key: 'loops', label: 'Loops', href: '/loops', glyph: <Repeat className="size-4" /> },
  { key: 'history', label: 'Activities', href: '/loops/activity', glyph: <History className="size-4" /> },
];

export function LoopsTabsNav({ active }: { active: LoopsView }) {
  return <NavTabs tabs={TABS} active={active} label="Loops views" />;
}
