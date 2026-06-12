import { mockLatency } from '@/mock/config';
import nodesSeed from '@/mock/seed/journal-nodes.json';
import logSeed from '@/mock/seed/journal-log.json';
// Type-only imports — erased at runtime, so no cycle with store-reader (which
// imports this module at runtime for its mock guards).
import type { JournalReadOutcome, JournalNode, LogEntry, NodeSummary } from '@/journal/types';
import type { ReadNodeResult, NodeFrontmatter } from '@/journal/store-reader';

// The journal is READ-ONLY, so no write store — just serve the seed.
const nodes = nodesSeed as JournalNode[];
const log = logSeed as LogEntry[];

/** First-paint read: node summaries + the write log. */
export async function readAllNodes(): Promise<JournalReadOutcome> {
  await mockLatency();
  const summaries: NodeSummary[] = nodes
    .map((n) => ({ id: n.id, title: n.title, status: n.status, tags: n.tags, date: n.date, filename: n.filename }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { kind: 'ok', nodes: summaries, log: [...log], skippedCount: 0 };
}

/** Lazy single-node body load. */
export async function readNode(id: string): Promise<ReadNodeResult> {
  await mockLatency();
  if (!/^\d{4}$/.test(id)) {
    return { ok: false, error: { id: null, filename: id, reason: 'invalid node id' } };
  }
  const node = nodes.find((n) => n.id === id);
  if (!node) {
    return { ok: false, error: { id, filename: `nodes/${id}-*.md`, reason: 'node file missing' } };
  }
  return { ok: true, node };
}

/** Frontmatter (links + supersededBy) for the server-side inbound-edge computation. */
export async function readNodeFrontmatters(): Promise<NodeFrontmatter[]> {
  return nodes.map((n) => ({ id: n.id, links: n.links, supersededBy: n.supersededBy }));
}
