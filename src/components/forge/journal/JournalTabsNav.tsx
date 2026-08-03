import { BookOpen, Hexagon, Share2, History } from 'lucide-react';
import { NavTabs } from '@/components/ui/nav-tabs';

/**
 * The Journal tab bar — the PageFrame header sub-nav, rendered by the shared `NavTabs`,
 * Link-based so each view is a real navigation. Server component; the active tab
 * is passed in. Order: Recall · Nodes · Graph · Log.
 */
/**
 * The views, in tab order — ONE definition.
 *
 * This was a union here, the same four keys again in `TABS`, and three of them a third
 * time in `journal/page.tsx`'s `normalizeView`. A fifth view would have gone: missing from
 * the type, absent from the tab bar, and — worst — silently redirected to Recall by the
 * normalizer, so `?view=timeline` would render the wrong tab with no error. `usage/period.ts`
 * already solves this exact shape (`PERIODS` + `parsePeriod`); this follows it.
 */
export const JOURNAL_VIEWS = ['recall', 'nodes', 'graph', 'log'] as const;
export type JournalView = (typeof JOURNAL_VIEWS)[number];

/** What a page shows when the URL names no view, or names one that is not valid. */
export const DEFAULT_JOURNAL_VIEW: JournalView = 'recall';

/** Narrow an untrusted `?view=` to a real one. */
export function parseJournalView(raw: string | null | undefined): JournalView {
  return (JOURNAL_VIEWS as readonly string[]).includes(raw ?? '')
    ? (raw as JournalView)
    : DEFAULT_JOURNAL_VIEW;
}

/** Label + glyph per view. Total over `JournalView`, so a new view fails the build here. */
const TAB_CHROME: Record<JournalView, { label: string; glyph: React.ReactNode }> = {
  recall: { label: 'Recall', glyph: <BookOpen className="size-4" /> },
  nodes: { label: 'Nodes', glyph: <Hexagon className="size-4" /> },
  graph: { label: 'Graph', glyph: <Share2 className="size-4" /> },
  log: { label: 'Log', glyph: <History className="size-4" /> },
};

export function JournalTabsNav({ active }: { active: JournalView }) {
  const tabs = JOURNAL_VIEWS.map((key) => ({ key, ...TAB_CHROME[key], href: `/journal?view=${key}` }));
  return <NavTabs tabs={tabs} active={active} label="Journal views" />;
}
