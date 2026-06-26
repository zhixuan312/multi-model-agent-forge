import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { MetricRow, MetricCard, type MetricCardProps } from '@/components/ui/metric-card';

export interface StatusDashboardProps {
  metrics: MetricCardProps[];
  primary: ReactNode;
  aside?: ReactNode;
  className?: string;
}

export function StatusDashboard({ metrics, primary, aside, className }: StatusDashboardProps) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-4', className)}>
      {metrics.length > 0 ? (
        <MetricRow className="shrink-0">
          {metrics.map((m, i) => (
            <MetricCard key={i} {...m} />
          ))}
        </MetricRow>
      ) : null}

      {aside ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
          <div className="flex min-h-0 flex-col lg:col-span-2">
            {primary}
          </div>
          <div className="flex min-h-0 flex-col gap-4">
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
