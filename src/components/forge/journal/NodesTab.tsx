'use client';
import type { MetricCardProps } from '@/components/ui/metric-card';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui';
import { NodesView } from '@/components/forge/journal/NodesView';
import { LazyNodeDetail } from '@/components/forge/journal/journal-shell';
import { StageShell } from '@/components/patterns/stage-shell';
import { JournalNote } from '@/components/forge/journal/JournalNote';
import type { NodeSummary } from '@/journal/types';

/**
 * The Nodes tab. The 2/3 canvas shows the selected node's full detail —
 * defaulting to the FIRST node so it's never empty. The rail carries the journal
 * note and the searchable/filterable node list. Selection is URL-driven (`?node=`).
 * The journal is read-only here: nodes are written by MMA at project freeze and read
 * server-side, so there is no in-app "record" (a stubbed one that only wrote a client
 * store — faking success and losing the entry on reload — was removed).
 */
export function NodesTab({
  nodes,
  skippedCount,
  initialNode,
  metrics,
}: {
  nodes: NodeSummary[];
  skippedCount: number;
  initialNode?: string;
  metrics?: MetricCardProps[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Default to the first ADOPTED node — the list's own default filter is adopted-only, so
  // defaulting to a raw nodes[0] that happens to be superseded/dropped would show a detail
  // pane for a node absent from the visible list (nothing highlighted). Fall back to nodes[0]
  // only when there are no adopted nodes.
  const defaultNode = nodes.find((n) => n.status === 'adopted') ?? nodes[0];
  const selectedId = initialNode ?? searchParams.get('node') ?? defaultNode?.id ?? null;

  function select(id: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('view', 'nodes');
    sp.set('node', id);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <StageShell
      metrics={metrics}
      note={<JournalNote />}
      navigator={
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex shrink-0 items-center">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Nodes</span>
            </div>
            <NodesView
              nodes={nodes}
              skippedCount={skippedCount}
              selectedId={selectedId}
              onSelect={select}
            />
          </CardContent>
        </Card>
      }
    >
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            {selectedId ? (
              <LazyNodeDetail id={selectedId} onNavigate={select} />
            ) : (
              <p className="px-1 py-10 text-center text-sm text-ink-faint">No nodes to show.</p>
            )}
          </CardContent>
        </Card>
    </StageShell>
  );
}
