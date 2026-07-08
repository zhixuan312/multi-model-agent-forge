import { formatCost, formatDuration } from '@/usage/format';
import type { RouteAggRow } from '@/usage/usage-core';

export function RouteBreakdown({ routes }: { routes: RouteAggRow[] }) {
  if (routes.length === 0) {
    return <div className="px-6 py-4 text-sm text-ink-faint">No tasks recorded.</div>;
  }
  return (
    <div className="bg-surface-2/50 px-6 py-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-faint">
            <th className="pb-1.5 font-medium">Route</th>
            <th className="pb-1.5 text-right font-medium">Calls</th>
            <th className="pb-1.5 text-right font-medium">Total cost</th>
            <th className="pb-1.5 text-right font-medium">Saved</th>
            <th className="pb-1.5 text-right font-medium">Total time</th>
            <th className="pb-1.5 text-right font-medium">Avg cost</th>
            <th className="pb-1.5 text-right font-medium">Avg time</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <tr key={r.route} className="border-t border-line/50">
              <td className="py-1.5 font-mono text-xs">{r.route}</td>
              <td className="py-1.5 text-right tabular-nums">{r.callCount}</td>
              <td className="py-1.5 text-right tabular-nums">{formatCost(r.totalCostUsd)}</td>
              <td className="py-1.5 text-right tabular-nums text-[var(--sage)]">{formatCost(r.totalSavedUsd || null)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatDuration(r.totalDurationMs)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatCost(r.avgCostUsd)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatDuration(r.avgDurationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
