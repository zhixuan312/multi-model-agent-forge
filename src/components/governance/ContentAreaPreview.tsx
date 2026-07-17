'use client';

import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui';
import { StatusDashboard } from '@/components/patterns/status-dashboard';
import { RailNote } from '@/components/patterns/feature-rail';
import { SAMPLE_METRICS, MetricsRowPreview } from '@/components/governance/MetricsRowPreview';
import { CONTENT_SHELL_VARIANTS, defaultEnabledAffordances } from '@/components/governance/variant-meta';

/**
 * The standardized Content Shell — a 2/3 work surface (left panel) + a 1/3 rail (a note +
 * the right panel), with an OPTIONAL metrics row (the bars) on top. Not every page has the
 * metrics row, so it's a governed affordance. Real StatusDashboard (metrics + primary + aside).
 */
function DashboardShell({ showMetrics, showRail }: { showMetrics: boolean; showRail: boolean }) {
  return (
    <StatusDashboard
      metrics={showMetrics ? SAMPLE_METRICS.slice(0, 4) : []}
      primary={
        <Card className="h-full">
          <CardContent className="py-10 text-center text-sm text-ink-faint">Left panel</CardContent>
        </Card>
      }
      aside={
        <>
          <RailNote icon={<Info />} title="Rail note">Notes / guidance for this page.</RailNote>
          {showRail ? (
            <Card>
              <CardContent className="py-6 text-sm text-ink-faint">Right panel</CardContent>
            </Card>
          ) : null}
        </>
      }
    />
  );
}

const RENDERS: Record<string, (on: ReadonlySet<string>) => ReactNode> = {
  // The shell — metrics row + right panel are both affordances (default on). Rail off = full-width.
  dashboard: (on) => <DashboardShell showMetrics={on.has('metrics')} showRail={on.has('rail')} />,
  // The metric-box count variants (3 · 4 · 5) together.
  metricCounts: () => <MetricsRowPreview />,
};

/** Renders one Content Shell sub-page, by id, honouring its affordance toggles. */
export function ContentAreaVariant({ id, enabled }: { id: string; enabled?: ReadonlySet<string> }) {
  const render = RENDERS[id];
  const meta = CONTENT_SHELL_VARIANTS.find((v) => v.id === id);
  const on = enabled ?? defaultEnabledAffordances(meta ?? {});
  return <>{render ? render(on) : null}</>;
}

/** Overview (the slot default page) — the dashboard shell with metrics + rail on. */
export function ContentAreaPreview() {
  return <DashboardShell showMetrics showRail />;
}
