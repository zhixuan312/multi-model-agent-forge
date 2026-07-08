import { NextResponse, type NextRequest } from 'next/server';
import { guardJournal } from '@/journal/guard';
import { readLog } from '@/journal/store-reader';

/**
 * `GET /api/journal/log` — the parsed `log.md` entries in file (append,
 * chronological) order. Auth-gated. The view renders them newest-first (reverse
 * append order). Missing log → `[]` (empty state), never a 500.
 */
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await guardJournal(req, { checkCsrf: false });
  if (guard instanceof NextResponse) return guard;

  const root = guard.team.workspaceRootPath;
  try {
    const log = await readLog(root);
    return NextResponse.json({ log });
  } catch {
    // EACCES on the log file — degrade to empty rather than 500.
    return NextResponse.json({ log: [] });
  }
}
