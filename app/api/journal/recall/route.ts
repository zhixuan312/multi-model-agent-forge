import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guardJournal } from '@/journal/guard';
import { buildMmaClient } from '@/mma/server-client';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { dispatchRecall } from '@/journal/recall';
import { logAction } from '@/observability/action-log';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/mma';

/**
 * `POST /api/journal/recall` — the ONE money-spending endpoint in Spec 6.
 *
 * Guarded: CSRF (same-origin) → auth (any member; no admin). The query is
 * TRIMMED then length-checked (10–4000), matching MMA's `.trim().min(10).max(4000)`
 * order so Forge rejects a sub-floor query before dispatch. On valid input it
 * dispatches `journal-recall` at the WORKSPACE ROOT (never a project repo) →
 * returns `202 {batchId}`; the browser polls `GET /batch/:id` directly.
 *
 * A team-level `action_log` row (`project_id` NULL) records the spend for audit
 * parity (`action_log.project_id` is nullable — schema.md §10).
 */
export const runtime = 'nodejs';

const bodySchema = z.object({ query: z.string() });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardJournal(req, { checkCsrf: true });
  if (guard instanceof NextResponse) return guard;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'A query is required.' }, { status: 400 });
  }
  const query = parsed.data.query.trim();
  if (query.length < 10) {
    return NextResponse.json({ error: 'Query must be at least 10 characters.' }, { status: 400 });
  }
  if (query.length > 4000) {
    return NextResponse.json({ error: 'Query must be at most 4000 characters.' }, { status: 400 });
  }

  const workspaceRoot = resolveWorkspaceRoot();
  let client;
  try {
    client = await buildMmaClient();
  } catch {
    return NextResponse.json(
      { error: 'Journal recall unavailable — MMA is not configured.' },
      { status: 503 },
    );
  }

  let result: { batchId: string };
  try {
    result = await dispatchRecall(client, workspaceRoot, query);
  } catch {
    return NextResponse.json(
      { error: 'Journal recall unavailable — MMA may be restarting.' },
      { status: 503 },
    );
  }

  // Persist an ops_mma_batch row so usage tracking captures this dispatch.
  const db = getDb();
  await db
    .insert(mmaBatch)
    .values({
      projectId: null,
      route: 'journal_recall',
      cwd: workspaceRoot,
      batchId: result.batchId,
      status: 'dispatched',
      request: { query },
      dispatchedBy: guard.memberId,
    })
    .catch(() => {});

  // Team-level audit row (project-less). Best-effort: a logging failure must not
  // fail the dispatch that already succeeded.
  await logAction({
    projectId: null,
    memberId: guard.memberId,
    action: 'journal_recall',
    target: query,
  }).catch(() => {});

  return NextResponse.json({ batchId: result.batchId }, { status: 202 });
}
