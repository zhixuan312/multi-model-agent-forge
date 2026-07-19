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

/**
 * A scroll region that does not clip the cards inside it.
 *
 * A scroll container clips on EVERY side, so a card flush against one loses part of its
 * hover bloom. These are the shadow's real reach (`0 10px 30px -8px` → 7px sideways, ~0 up,
 * 17px down) turned into clearance. Each side pairs a negative margin with equal padding, so
 * the clearance lives INSIDE the scroller without costing layout height — the pull-out stays
 * UNDER the 16px grid gap, so the scroller can never overlap what sits above it.
 *
 * The bottom needs the pair too. With `pb-6` alone the padding sat inside a box that ended at
 * the grid line, so the last card stopped 24px short of the left column. With `-mb-6 pb-6`
 * the box extends 24px into the page's own bottom padding: the card now finishes level with
 * the left column AND its hover bloom still has room before the scroller clips.
 *
 * Plain Tailwind classes on purpose. This was a `@utility scroll-pane` in globals.css, and
 * that emitted NO CSS at all — every `lg:scroll-pane` column computed `overflow-y: visible`,
 * so the panels silently never scrolled at desktop widths. A custom at-rule that produces
 * nothing fails invisibly; these classes are verifiable in the served stylesheet.
 */
export const SCROLL_PANE = 'min-h-0 overflow-y-auto -mx-3 -mt-3 -mb-6 px-3 pt-3 pb-6';

/** The same pane, from `lg` up. Spelled out literally, NOT built at runtime: Tailwind
 *  scans source text, so a computed class string generates no CSS — the identical trap
 *  that made the `@utility` version silently do nothing. */
export const SCROLL_PANE_LG =
  'lg:min-h-0 lg:overflow-y-auto lg:-mx-3 lg:-mt-3 lg:-mb-6 lg:px-3 lg:pt-3 lg:pb-6';

export function StatusDashboard({ metrics, primary, aside, align = 'stretch', scroll = 'inner', className }: StatusDashboardProps) {
  // `flex-1` as well as `h-full`: every stage renders this as a flex ITEM below the
  // AutomationBar, and `h-full` there means 100% of the PARENT — the full height, as if the
  // bar took none. The dashboard then overflowed by the bar's height, and because PageFrame
  // stops the page scrolling, the overflow was simply clipped and the column's scroll-pane
  // never got a correct bound. `flex-1` claims the REMAINING space instead. (In a column,
  // flex-basis:0 wins over height:100%, so the two don't fight; when the parent isn't a flex
  // container, flex-1 is inert and h-full still applies.)
  // Below `lg` the two panels stack and the per-column `scroll-pane`s do NOT apply, so the
  // shell itself must scroll. It used to rely on the PAGE scrolling there — but PageFrame
  // `fill` sets overflow-hidden at EVERY width, so under `lg` (including a zoomed browser,
  // where the CSS viewport shrinks) there was no scroller at all and content was clipped
  // outright. From `lg` up this goes back to visible so the columns own their scroll and
  // the cards' hover bloom isn't trimmed at the shell edge.
  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-1 flex-col gap-4',
        'overflow-y-auto overflow-x-hidden lg:overflow-visible',
        className,
      )}
    >
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
            // The row must be bounded too, not just the grid box. With the default
            // `auto` row the track sizes to the TALLEST column, so a long panel made the
            // row overflow the container and the columns' scroll-pane had nothing to
            // scroll inside — the panel just ran past the bottom of the shell.
            'lg:grid-rows-[minmax(0,1fr)]',
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
              scroll === 'outer' && SCROLL_PANE_LG,
            )}
          >
            {primary}
          </div>
          <div
            className={cn(
              'flex min-h-0 flex-col gap-4',
              // The rail's last child fills the leftover height, so the RIGHT PANEL reaches
              // the bottom instead of stopping short. Excluded: a `RailNote`, which is
              // guidance and always wraps its own content — when a page has only a note, or
              // ends with one (Projects: attention card THEN pipeline note), nothing
              // stretches and the column simply ends. Not every page has a right panel.
              // `grow` (flex-grow:1, basis auto) NOT `flex-1` (basis 0): basis 0 would let
              // a tall panel be squashed instead of making the column scroll.
              '[&>*:last-child:not([data-rail-note])]:grow',
              // The rail scrolls and clips too — same governed pane.
              SCROLL_PANE_LG,
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
