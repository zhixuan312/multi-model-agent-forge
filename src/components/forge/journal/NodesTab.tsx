'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui';
import { NodesView } from '@/components/forge/journal/NodesView';
import { JournalNote } from '@/components/forge/journal/JournalNote';
import { RailLayout, LazyNodeDetail } from '@/components/forge/journal/journal-shell';
import type { NodeSummary } from '@/journal/types';

/**
 * The Nodes tab. The 2/3 canvas shows the selected node's full detail —
 * defaulting to the FIRST node so it's never empty. The rail carries the journal
 * note, then the searchable/filterable node list (the user's input) below it.
 * Selection is URL-driven (`?node=`).
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

  const selectedId = initialNode ?? searchParams.get('node') ?? nodes[0]?.id ?? null;

  function select(id: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('view', 'nodes');
    sp.set('node', id);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <RailLayout
      rail={
        <>
          <JournalNote />
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <NodesView
                nodes={nodes}
                skippedCount={skippedCount}
                selectedId={selectedId}
                onSelect={select}
              />
            </CardContent>
          </Card>
        </>
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
    </RailLayout>
  );
}
