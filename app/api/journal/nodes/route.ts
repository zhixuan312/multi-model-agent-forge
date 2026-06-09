import { NextResponse, type NextRequest } from 'next/server';
import { guardJournal } from '@/journal/guard';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { readAllNodes } from '@/journal/store-reader';

/**
 * `GET /api/journal/nodes` — the reconciled node index (frontmatter-only summaries,
 * no bodies). Auth-gated (any member). Returns the `JournalReadOutcome`
 * discriminated union (`ok | empty | unreadable | unconfigured`) so the client
 * renders the right state without a 500.
 */
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await guardJournal(req, { checkCsrf: false });
  if (guard instanceof NextResponse) return guard;

  const root = resolveWorkspaceRoot();
  const outcome = await readAllNodes(root);
  return NextResponse.json(outcome);
}
