import { NextResponse, type NextRequest } from 'next/server';
import { guardJournal } from '@/journal/guard';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { readNode, readNodeFrontmatters, computeInbound } from '@/journal/store-reader';

/**
 * `GET /api/journal/nodes/[id]` — lazy single-node body load. Auth-gated.
 *
 * Defence-in-depth id guard: the route rejects any id that isn't `^\d{4}$`
 * (400) BEFORE invoking the reader, so a crafted `../etc` / `12` / `abc` never
 * reaches the filesystem layer (the reader's confinement assert is the backstop).
 *
 * The response carries the node JSON PLUS the SERVER-COMPUTED inbound-edge list
 * (and any `supersededBy` inbound entry) — the client index rows don't carry
 * `links`, so the client cannot compute inbound itself.
 */
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await guardJournal(req, { checkCsrf: false });
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  if (!/^\d{4}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid node id.' }, { status: 400 });
  }

  const root = resolveWorkspaceRoot();
  const result = await readNode(root, id);
  if (!result.ok) {
    // Unparseable / missing node → a marker the detail pane renders, not a crash.
    return NextResponse.json({ node: null, parseError: result.error, inbound: [] });
  }

  // Inbound edges: in-memory inversion over every node's frontmatter (F16).
  const all = await readNodeFrontmatters(root);
  const inbound = computeInbound(all, id);

  return NextResponse.json({ node: result.node, parseError: null, inbound });
}
