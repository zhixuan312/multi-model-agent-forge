'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui';
import { NodesView } from '@/components/forge/journal/NodesView';
import { NodeDetail } from '@/components/forge/journal/NodeDetail';
import { LazyNodeDetail } from '@/components/forge/journal/journal-shell';
import { StatusDashboard } from '@/components/patterns/status-dashboard';
import { RecordLearningButton } from '@/components/forge/journal/RecordLearningButton';
import { useRecordedLearnings } from '@/components/forge/journal/recorded-store';
import type { NodeSummary } from '@/journal/types';

/**
 * The Nodes tab. The 2/3 canvas shows the selected node's full detail —
 * defaulting to the FIRST node so it's never empty. The rail carries the journal
 * note, a "Record a learning" action, then the searchable/filterable node list.
 * Selection is URL-driven (`?node=`). Learnings recorded this session (via the
 * Record dialog) are merged in from a client store — newest first, ahead of the
 * server-read nodes — and their detail renders straight from that store.
 */
export function NodesTab({
  nodes,
  skippedCount,
  initialNode,
}: {
  nodes: NodeSummary[];
  skippedCount: number;
  initialNode?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const recorded = useRecordedLearnings();

  const recordedSummaries: NodeSummary[] = recorded.map((n) => ({
    id: n.id,
    title: n.title,
    status: n.status,
    tags: n.tags,
    timestamp: n.timestamp,
    filename: n.filename,
    source: n.source,
    type: n.type,
    description: n.description,
  }));
  const allNodes = [...recordedSummaries, ...nodes];

  const selectedId = initialNode ?? searchParams.get('node') ?? allNodes[0]?.id ?? null;
  const selectedRecorded = recorded.find((n) => n.id === selectedId) ?? null;

  function select(id: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('view', 'nodes');
    sp.set('node', id);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <StatusDashboard
      aside={
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex shrink-0 items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Nodes</span>
              <RecordLearningButton />
            </div>
            <NodesView
              nodes={allNodes}
              skippedCount={skippedCount}
              selectedId={selectedId}
              onSelect={select}
            />
          </CardContent>
        </Card>
      }
      primary={
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            {selectedRecorded ? (
              <NodeDetail node={selectedRecorded} inbound={[]} onNavigate={select} />
            ) : selectedId ? (
              <LazyNodeDetail id={selectedId} onNavigate={select} />
            ) : (
              <p className="px-1 py-10 text-center text-sm text-ink-faint">No nodes to show.</p>
            )}
          </CardContent>
        </Card>
      }
    />
  );
}
