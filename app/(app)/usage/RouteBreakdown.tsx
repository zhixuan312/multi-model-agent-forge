import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCost, formatDuration } from '@/usage/format';
import type { RouteAggRow } from '@/usage/usage-core';

/**
 * Per-route usage breakdown. Built on the governed Table primitives; the compact
 * padding overrides are deliberate — this is a dense drill-down nested inside a row,
 * not a top-level data table.
 */
export function RouteBreakdown({ routes }: { routes: RouteAggRow[] }) {
  if (routes.length === 0) {
    return <div className="px-6 py-4 text-sm text-ink-faint">No tasks recorded.</div>;
  }
  const num = 'py-1.5 px-0 text-right tabular-nums';
  const head = 'px-0 py-0 pb-1.5 font-sans text-sm normal-case tracking-normal text-ink-faint';
  return (
    <div className="bg-surface-2/50 px-6 py-4">
      <Table className="text-sm">
        <TableHeader>
          <TableRow className="border-0">
            <TableHead className={head}>Route</TableHead>
            <TableHead className={`${head} text-right`}>Calls</TableHead>
            <TableHead className={`${head} text-right`}>Total cost</TableHead>
            <TableHead className={`${head} text-right`}>Saved</TableHead>
            <TableHead className={`${head} text-right`}>Total time</TableHead>
            <TableHead className={`${head} text-right`}>Avg cost</TableHead>
            <TableHead className={`${head} text-right`}>Avg time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {routes.map((r) => (
            <TableRow key={r.route} className="border-b-0 border-t border-line/50">
              <TableCell className="px-0 py-1.5 font-mono text-xs">{r.route}</TableCell>
              <TableCell className={num}>{r.callCount}</TableCell>
              <TableCell className={num}>{formatCost(r.totalCostUsd)}</TableCell>
              <TableCell className={`${num} text-[var(--sage)]`}>{formatCost(r.totalSavedUsd || null)}</TableCell>
              <TableCell className={num}>{formatDuration(r.totalDurationMs)}</TableCell>
              <TableCell className={num}>{formatCost(r.avgCostUsd)}</TableCell>
              <TableCell className={num}>{formatDuration(r.avgDurationMs)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
