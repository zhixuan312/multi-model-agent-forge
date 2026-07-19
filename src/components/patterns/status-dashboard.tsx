import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { MetricRow, MetricCard, type MetricCardProps } from '@/components/ui/metric-card';

export interface StatusDashboardProps {
  /** Optional metrics row across the top — omitted / empty renders no row. */
  metrics?: MetricCardProps[];
  /** The 2/3 main work surface (or full-width when there's no `aside`). */
  primary: ReactNode;
  /** The 1/3 rail. When present the body becomes a 2/3 + 1/3 split. */
  aside?: ReactNode;
  /**
   * Rail alignment on the cross axis. `stretch` (default) makes the rail match the
   * primary's height — the dashboard/stage look. `start` top-aligns the rail against
   * the primary — the settings look (a form beside a shorter guidance rail).
   */
  align?: 'stretch' | 'start';
  /** Who owns the scroll in the 2/3 column. `inner` (default) when a SINGLE item fills it
   *  and scrolls itself — a table body, a document body, a list. `outer` when the panel
   *  STACKS several cards and the column must scroll past them. */
  scroll?: 'inner' | 'outer';
  className?: string;
}

export function StatusDashboard({ metrics, primary, aside, align = 'stretch', scroll = 'inner', className }: StatusDashboardProps) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-4', className)}>
      {metrics && metrics.length > 0 ? (
        <MetricRow className="shrink-0">
          {metrics.map((m, i) => (
            <MetricCard key={i} {...m} />
          ))}
        </MetricRow>
      ) : null}

      {aside ? (
        <div
          className={cn(
            'grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3',
            // `start` top-aligns the rail — but a column can only scroll when it is
            // height-bounded, so a panel that owns its scroll must stretch regardless.
            align === 'start' && scroll !== 'outer' ? 'lg:items-start' : 'lg:items-stretch',
          )}
        >
          {/* In the dashboard (`stretch`) look the two panels are height-bounded, so each
              scrolls INTERNALLY on desktop (`lg:overflow-y-auto`) — the left work surface and
              the right rail scroll independently instead of overflowing or scrolling the page.
              On mobile (stacked) and in the `start`/settings look the page scrolls instead. */}
          {/* WHO SCROLLS depends on what is in the panel:
              - `inner` (default): ONE item fills the 2/3 column and scrolls inside itself —
                a table body, a document body, a list. The column must NOT scroll, or the
                item and the column both would.
              - `outer`: the panel STACKS several cards (usage = chart + table, team settings
                = two forms), so the column scrolls past them.
              A scroll container clips on every side, so in `outer` a card's hover bloom is
              trimmed at the column edge. Do NOT "fix" that with `-m-* p-*`: the negative
              margin pulls the scroller outside its grid cell and scrolled content bleeds
              over the metrics row. */}
          <div
            className={cn(
              'flex min-h-0 flex-col lg:col-span-2',
              // Independent of `align`: that governs the rail's cross-axis alignment, this
              // governs who scrolls. Coupling them left every `align="start"` page with no
              // scroller at all once PageFrame stopped scrolling the page.
              // `scroll-pane` (globals.css) owns the overflow AND the clearance that keeps
              // the cards' hover bloom from being clipped by this scroller.
              scroll === 'outer' && 'lg:scroll-pane',
            )}
          >
            {primary}
          </div>
          <div
            className={cn(
              'flex min-h-0 flex-col gap-4',
              // The rail scrolls and clips too — same governed pane.
              'lg:scroll-pane',
            )}
          >
            {aside}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          {primary}
        </div>
      )}
    </div>
  );
}
