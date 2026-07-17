'use client';

import { AlertTriangle, Clock, Hammer, LayoutGrid, Sparkles } from 'lucide-react';
import { MetricCard, MetricRow } from '@/components/ui';
import type { MetricCardProps } from '@/components/ui/metric-card';

// The real metric cards (mirrors the shipped projects dashboard): neutral card, colored
// icon tint, sublabel, muted when zero. Shared with the Content-area preview.
export const SAMPLE_METRICS: MetricCardProps[] = [
  { label: 'Active', value: 4, sublabel: 'In flight', icon: <LayoutGrid />, iconTint: 'accent' },
  { label: 'Waiting for human', value: 1, sublabel: 'Need a decision', icon: <Clock />, iconTint: 'amber' },
  { label: 'Agents running', value: 0, muted: true, sublabel: 'Live agent work', icon: <Sparkles />, iconTint: 'sage' },
  { label: 'Build', value: 0, muted: true, sublabel: 'Shipping', icon: <Hammer />, iconTint: 'steel' },
  { label: 'Audit issues', value: 1, sublabel: 'Open findings', icon: <AlertTriangle />, iconTint: 'rose' },
];

/**
 * The metrics row (MetricRow) — an auto-fitting row of MetricCards. Shown at its
 * supported counts: 3, 4, and 5 boxes.
 */
export function MetricsRowPreview() {
  return (
    <div className="flex flex-col gap-5">
      {[3, 4, 5].map((n) => (
        <div key={n} className="flex flex-col gap-1.5">
          <span className="text-xs text-ink-faint">{n} boxes</span>
          <MetricRow>
            {SAMPLE_METRICS.slice(0, n).map((m, i) => (
              <MetricCard key={i} {...m} />
            ))}
          </MetricRow>
        </div>
      ))}
    </div>
  );
}
