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
  className?: string;
}

export function StatusDashboard({ metrics, primary, aside, align = 'stretch', className }: StatusDashboardProps) {
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
            align === 'start' ? 'lg:items-start' : 'lg:items-stretch',
          )}
        >
          {/* In the dashboard (`stretch`) look the two panels are height-bounded, so each
              scrolls INTERNALLY on desktop (`lg:overflow-y-auto`) — the left work surface and
              the right rail scroll independently instead of overflowing or scrolling the page.
              On mobile (stacked) and in the `start`/settings look the page scrolls instead. */}
          <div
            className={cn(
              'flex min-h-0 flex-col lg:col-span-2',
              align === 'stretch' && 'lg:min-h-0 lg:overflow-y-auto',
            )}
          >
            {primary}
          </div>
          <div
            className={cn(
              'flex min-h-0 flex-col gap-4',
              align === 'stretch' && 'lg:min-h-0 lg:overflow-y-auto',
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
