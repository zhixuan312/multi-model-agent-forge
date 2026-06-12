'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent, Eyebrow } from '@/components/ui';
import { JournalNote } from '@/components/forge/journal/JournalNote';
import { JournalGraph3D } from '@/components/forge/journal/JournalGraph3D';
import { RailLayout } from '@/components/forge/journal/journal-shell';
import { STATUS_HEX, EDGE_HEX } from '@/components/forge/journal/graph-palette';
import type { GraphNode, GraphEdge } from '@/journal/graph';

/**
 * The Graph tab — the decision graph as an interactive 3D "planet" on the 2/3
 * canvas, with the journal note + a colour legend in the rail. Clicking a node
 * routes to it in the Nodes tab.
 */
export function GraphTab({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const router = useRouter();
  const onOpen = (id: string) => router.push(`/journal?view=nodes&node=${id}`);

  return (
    <RailLayout
      rail={
        <>
          <JournalNote />
          <GraphLegend />
        </>
      }
    >
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardContent className="min-h-0 flex-1 p-1.5">
          {nodes.length ? (
            <JournalGraph3D nodes={nodes} edges={edges} onOpen={onOpen} />
          ) : (
            <p className="px-3 py-10 text-center text-sm text-ink-faint">No nodes to graph yet.</p>
          )}
        </CardContent>
      </Card>
    </RailLayout>
  );
}

/** Status-colour + edge-type key for the network. */
function GraphLegend() {
  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-surface px-4 py-4">
      <Eyebrow as="h3" className="text-ink-faint">Legend</Eyebrow>
      <div className="mt-3 flex flex-col gap-3">
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-soft">Node status</p>
          <ul className="flex flex-col gap-1">
            {Object.entries(STATUS_HEX).map(([status, hex]) => (
              <li key={status} className="flex items-center gap-2 text-xs text-ink-soft">
                <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: hex }} />
                {status}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-soft">Edge type</p>
          <ul className="flex flex-col gap-1">
            {Object.entries(EDGE_HEX).map(([type, hex]) => (
              <li key={type} className="flex items-center gap-2 text-xs text-ink-soft">
                <span
                  className="h-0.5 w-5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: hex,
                    ...(type === 'supersedes'
                      ? { backgroundImage: `repeating-linear-gradient(90deg, ${hex} 0 4px, transparent 4px 7px)`, backgroundColor: 'transparent' }
                      : {}),
                  }}
                />
                {type}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
