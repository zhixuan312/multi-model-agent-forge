'use client';
import type { MetricCardProps } from '@/components/ui/metric-card';

import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { JournalGraph3D } from '@/components/forge/journal/JournalGraph3D';
import { StageShell } from '@/components/patterns/stage-shell';
import { JournalNote } from '@/components/forge/journal/JournalNote';
import { STATUS_HEX, EDGE_HEX } from '@/components/forge/journal/graph-palette';
import type { GraphNode, GraphEdge } from '@/journal/graph';

/**
 * The Graph tab — the decision graph as an interactive night sky on the 2/3
 * canvas, with the shared journal note above a Legend right-panel (the key).
 * Clicking a node routes to it in the Nodes tab.
 */
export function GraphTab({ nodes, edges, metrics }: { nodes: GraphNode[]; edges: GraphEdge[]; metrics?: MetricCardProps[] }) {
  const router = useRouter();
  const onOpen = (id: string) => router.push(`/journal?view=nodes&node=${id}`);

  return (
    <StageShell
      metrics={metrics}
      note={<JournalNote />}
      navigator={<GraphLegend />}
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
    </StageShell>
  );
}

/** Node-status meanings, folded into the legend so it doubles as the rail note. */
const STATUS_MEANING: Record<string, string> = {
  adopted: 'a live learning',
  superseded: 'replaced by a newer node',
  inconclusive: 'unresolved',
  dropped: 'abandoned',
};

/**
 * The Graph right-panel — the legend, as a governed Card panel (header + content),
 * the same shape as the Nodes and Recall right-panels rather than a second rail
 * note. Its bullet markers are colour swatches so it doubles as the graph's key.
 */
function GraphLegend() {
  const heading = 'mb-2 text-sm font-semibold text-ink';
  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader>
        <CardTitle>Legend</CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4 overflow-y-auto">
        <section>
          <h3 className={heading}>Node status</h3>
          <ul className="flex flex-col gap-1.5">
            {Object.entries(STATUS_HEX).map(([status, hex]) => (
              <li key={status} className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
                <span
                  className="mt-1 size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/5"
                  style={{ backgroundColor: hex }}
                />
                <span className="min-w-0">
                  <span className="font-semibold capitalize text-ink">{status}</span>
                  {STATUS_MEANING[status] ? ` — ${STATUS_MEANING[status]}` : null}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className={heading}>Edge type</h3>
          <ul className="flex flex-col gap-1.5">
            {Object.entries(EDGE_HEX).map(([type, hex]) => (
              <li key={type} className="flex items-center gap-2 text-xs text-ink-soft">
                <span
                  className="h-[3px] w-5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: hex,
                    ...(type === 'supersedes'
                      ? { backgroundImage: `repeating-linear-gradient(90deg, ${hex} 0 4px, transparent 4px 7px)`, backgroundColor: 'transparent' }
                      : {}),
                  }}
                />
                <span className="capitalize">{type}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className={heading}>Read-only</h3>
          <ul className="flex flex-col gap-1.5">
            <li className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
              <span><span className="font-semibold text-ink">Recorded by MMA</span> — written at project freeze, never edited here</span>
            </li>
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
