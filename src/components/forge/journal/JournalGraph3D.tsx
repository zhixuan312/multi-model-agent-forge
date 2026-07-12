'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { statusHex, edgeHex } from './graph-palette';
import type { GraphNode, GraphEdge } from '@/journal/graph';

/**
 * The 3D "planet" view of the decision graph (Soul-style) — a WebGL force-directed
 * graph (3d-force-graph / Three.js) where nodes settle into an organic rotating
 * ball on the warm-paper theme. It auto-orbits gently, pauses on hover, and
 * HIGHLIGHTS a node's connections (its neighbours stay coloured, links darken and
 * stream particles, everything else greys out). Click a node to open it. On load
 * it zooms to fit the whole graph. Browser-only (dynamic-imported in an effect).
 */
const HOVER_INK = '#211c16';
const DIM_NODE = 'rgba(33,28,22,0.10)';
const DIM_EDGE = 'rgba(33,28,22,0.04)';

/** Category tint (bg/fg) — matches the journal-stage category chips. */
const CAT_HEX: Record<string, { bg: string; fg: string }> = {
  decision: { bg: '#f3e3d6', fg: '#c4521e' },
  design: { bg: '#e7eff4', fg: '#355a74' },
  behavior: { bg: '#e7efe5', fg: '#3f5e41' },
  process: { bg: '#f6ecd6', fg: '#a9761a' },
  knowledge: { bg: '#f6e2e2', fg: '#b23a48' },
  style: { bg: '#efe9dd', fg: '#6b6051' },
};

export function JournalGraph3D({
  nodes,
  edges,
  onOpen,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onOpen: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onOpenRef = useRef(onOpen);
  // eslint-disable-next-line react-hooks/refs -- intentional: mirror latest onOpen into a ref so the long-lived 3D handlers read it without re-subscribing
  onOpenRef.current = onOpen;
  const [hovered, setHovered] = useState<{ id: string; title: string; status: string; source?: string | null; type?: string | null } | null>(null);

  const key = useMemo(
    () => JSON.stringify({ n: nodes.map((n) => `${n.id}:${n.status}`), e: edges }),
    [nodes, edges],
  );

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let graph: any;
    let ro: ResizeObserver | undefined;
    let cancelled = false;

    (async () => {
      // The package's default export is the kapsule factory: ForceGraph3D(cfg)(el).
      // Its bundled type is declared as the instance, so cast to call it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ForceGraph3D = (await import('3d-force-graph')).default as any;
      if (cancelled || !ref.current) return;

      const deg = new Map<string, number>();
      for (const e of edges) {
        deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
        deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
      }
      const maxDeg = Math.max(1, ...deg.values());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gnodes: any[] = nodes.map((n) => ({
        id: n.id,
        status: n.status,
        title: n.title,
        source: n.source ?? null,
        type: n.type ?? null,
        val: 1 + 7 * ((deg.get(n.id) ?? 0) / maxDeg),
        neighbors: new Set<string>(),
      }));
      const byId = new Map(gnodes.map((n) => [n.id, n]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const glinks: any[] = edges.map((e) => ({ source: e.source, target: e.target, type: e.type }));

      const nodeLinks = new Map<string, unknown[]>();
      for (const l of glinks) {
        byId.get(l.source)?.neighbors.add(l.target);
        byId.get(l.target)?.neighbors.add(l.source);
        (nodeLinks.get(l.source) ?? nodeLinks.set(l.source, []).get(l.source)!).push(l);
        (nodeLinks.get(l.target) ?? nodeLinks.set(l.target, []).get(l.target)!).push(l);
      }

      const hiNodes = new Set<string>();
      const hiLinks = new Set<unknown>();
      let hoverId: string | null = null;

      const el = ref.current;
      graph = ForceGraph3D({ controlType: 'orbit' })(el)
        .width(el.clientWidth)
        .height(el.clientHeight)
        .backgroundColor('rgba(0,0,0,0)') // transparent → warm paper backdrop shows
        .showNavInfo(false)
        .graphData({ nodes: gnodes, links: glinks })
        .nodeRelSize(4)
        .nodeResolution(14)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .nodeVal((n: any) => n.val)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .nodeColor((n: any) => (hoverId ? (hiNodes.has(n.id) ? statusHex(n.status) : DIM_NODE) : statusHex(n.status)))
        .nodeOpacity(0.95)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .nodeLabel((n: any) => {
          const cat = n.type
            ? `<span style="display:inline-block;font:600 10px ui-sans-serif,system-ui;text-transform:uppercase;letter-spacing:0.03em;color:${CAT_HEX[n.type]?.fg ?? '#6b6051'};background:${CAT_HEX[n.type]?.bg ?? '#f1ece2'};padding:1px 6px;border-radius:999px">${n.type}</span>`
            : '';
          return `<div style="font:600 12px ui-monospace,monospace;color:#211c16;background:rgba(255,255,255,0.97);padding:6px 9px;border-radius:7px;border:1px solid #e7e0d4;box-shadow:0 4px 14px rgba(33,28,22,0.12);max-width:300px;white-space:normal"><div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="color:#6b6051">${n.id}</span>${cat}</div>${n.title}</div>`;
        })
        .linkColor((l: unknown) => (hoverId ? (hiLinks.has(l) ? HOVER_INK : DIM_EDGE) : edgeHex((l as { type: string }).type)))
        .linkWidth((l: unknown) => (hiLinks.has(l) ? 1.6 : 0.4))
        .linkOpacity(0.34)
        .linkDirectionalParticles((l: unknown) => (hiLinks.has(l) ? 4 : 0))
        .linkDirectionalParticleWidth(1.8)
        .linkDirectionalParticleColor(() => HOVER_INK)
        .linkDirectionalParticleSpeed(0.012)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .onNodeClick((n: any) => onOpenRef.current(n.id))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .onNodeHover((n: any) => {
          hiNodes.clear();
          hiLinks.clear();
          hoverId = n ? n.id : null;
          if (n) {
            hiNodes.add(n.id);
            n.neighbors.forEach((id: string) => hiNodes.add(id));
            (nodeLinks.get(n.id) ?? []).forEach((l) => hiLinks.add(l));
          }
          setHovered(n ? { id: n.id, title: n.title, status: n.status, source: n.source, type: n.type } : null);
          if (graph.controls()) graph.controls().autoRotate = !n;
          if (el) el.style.cursor = n ? 'pointer' : 'grab';
          graph
            .nodeColor(graph.nodeColor())
            .linkColor(graph.linkColor())
            .linkWidth(graph.linkWidth())
            .linkDirectionalParticles(graph.linkDirectionalParticles());
        });

      const controls = graph.controls();
      if (controls) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;
        controls.enableDamping = true;
        controls.dampingFactor = 0.12;
      }
      // No camera/zoom customization — use the library's natural default framing.

      ro = new ResizeObserver(() => {
        if (graph && ref.current) graph.width(ref.current.clientWidth).height(ref.current.clientHeight);
      });
      ro.observe(el);
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      if (graph && typeof graph._destructor === 'function') graph._destructor();
    };
  }, [key, nodes, edges]);

  return (
    <div
      className="relative h-full min-h-[400px] w-full overflow-hidden rounded-[var(--r-md)] ring-1 ring-line"
      style={{
        backgroundColor: '#faf7f1',
        backgroundImage:
          'radial-gradient(ellipse at 50% 28%, rgba(196,82,30,0.05), transparent 62%),' +
          'radial-gradient(rgba(33,28,22,0.04) 1px, transparent 1px)',
        backgroundSize: '100% 100%, 24px 24px',
      }}
    >
      <div ref={ref} className="h-full w-full" style={{ cursor: 'grab' }} aria-label={`3D decision-graph — ${nodes.length} nodes, ${edges.length} edges`} role="img" />
      <div className="pointer-events-none absolute left-3.5 top-3.5 flex items-center gap-2 rounded-full bg-surface/75 px-2.5 py-1 text-[11px] font-medium tracking-wide text-ink-faint backdrop-blur-sm">
        <span className="inline-block size-1.5 rounded-full bg-accent/90" />
        drag to rotate · scroll to zoom · hover a node · click to open
      </div>
      {hovered ? (
        <div className="pointer-events-none absolute inset-x-3.5 bottom-3.5 flex items-center gap-2 rounded-[var(--r-md)] border border-line bg-surface/95 px-3 py-2 shadow-[var(--shadow-sm)] backdrop-blur-sm">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: statusHex(hovered.status) }} />
          <span className="font-mono text-xs text-ink-faint">{hovered.id}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{hovered.title}</span>
          {hovered.type ? (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ backgroundColor: CAT_HEX[hovered.type]?.bg ?? '#f1ece2', color: CAT_HEX[hovered.type]?.fg ?? '#6b6051' }}
            >
              {hovered.type}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
