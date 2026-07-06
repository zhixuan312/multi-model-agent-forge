import type { NodeFrontmatter } from '@/journal/store-reader';

/**
 * Pure graph model for the Journal → Graph tab. The page builds `{nodes, edges}`
 * server-side from the node summaries + frontmatters and hands them to the
 * client Cytoscape island. Edges are de-duplicated and dangling edges (pointing
 * at an id that isn't a known node) are dropped so the network never references
 * a phantom node.
 */

export interface GraphNode {
  id: string;
  status: string;
  title: string;
  source?: string;
  type?: string;
  description?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

/**
 * Derive the edge list from frontmatters. A node's `links` are forward edges
 * (`source → target`, typed). A node's `supersededBy` is the back-pointer of a
 * supersession, recorded as `superseder → this` so the arrow points from the
 * live node to the one it replaced — deduped against an explicit `supersedes`
 * link so the redundant double-encoding collapses to one edge.
 */
export function buildGraphEdges(frontmatters: NodeFrontmatter[], nodeIds: Set<string>): GraphEdge[] {
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];

  const add = (source: string, target: string, type: string) => {
    if (source === target) return;
    if (!nodeIds.has(source) || !nodeIds.has(target)) return; // drop dangling
    const key = `${source}->${target}:${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, type });
  };

  for (const fm of frontmatters) {
    for (const link of fm.links) add(fm.id, link.target, link.type);
    if (fm.supersededBy) add(fm.supersededBy, fm.id, 'supersedes');
  }
  return edges;
}
