/**
 * FAQ core (Spec: journal recall pins). The Recall tab's "Top-5 frequently asked"
 * is auto-derived from recall history — no curation, no table of its own.
 *
 * Source: `ops_mma_batch` rows where `route = 'journal_recall'` AND
 * `project_id IS NULL` (team-level recalls; project-scoped recalls would bias the
 * shared list). The recall route writes the original query to `request.prompt`.
 *
 * The most-recent N recall rows are fetched via the index
 * (`ops_mma_batch (created_at desc)`) — a bounded scan — then grouped by normalized
 * query (lowercased/trimmed) in JS, ranked by count desc then most-recent, top `limit`.
 * JS grouping keeps the ranking unit-testable; the bound keeps the read cheap.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { parseRecallEnvelope } from '@/journal/recall';

export interface FaqsDeps {
  db?: Db;
}

export interface Faq {
  question: string;
  count: number;
  /** Latest stored answer for this question (parsed from the most-recent completed recall),
   *  so a Frequent row renders like Pinned/Recent — a stored answer, not a fresh dispatch. */
  answerMd?: string;
  findings?: unknown[];
  citationIds?: string[];
}

/** Upper bound on rows aggregated — the most-recent recall queries. */
const SCAN_CAP = 1000;

export async function topFaqs(limit = 5, deps: FaqsDeps = {}): Promise<Faq[]> {
  const db = deps.db ?? getDb();
  // Light scan (no `result` payload) — group by question, and remember each group's most-recent
  // COMPLETED batch id so we can fetch just those answers below.
  const rows = await db
    .select({ id: mmaBatch.id, request: mmaBatch.request, createdAt: mmaBatch.createdAt, status: mmaBatch.status })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.route, 'journal_recall'), isNull(mmaBatch.projectId)))
    .orderBy(desc(mmaBatch.createdAt))
    .limit(SCAN_CAP);

  const groups = new Map<string, { question: string; count: number; recent: number; latestDoneAt: number; latestDoneId: string | null }>();
  for (const r of rows) {
    const question = String((r.request as { prompt?: string } | null)?.prompt ?? '').trim();
    if (!question) continue;
    const key = question.toLowerCase();
    const at = r.createdAt instanceof Date ? r.createdAt.getTime() : new Date(r.createdAt as unknown as string).getTime();
    const prev = groups.get(key);
    const isDone = r.status === 'done';
    if (prev) {
      prev.count += 1;
      if (at > prev.recent) {
        prev.recent = at;
        prev.question = question;
      }
      if (isDone && at > prev.latestDoneAt) {
        prev.latestDoneAt = at;
        prev.latestDoneId = r.id;
      }
    } else {
      groups.set(key, { question, count: 1, recent: at, latestDoneAt: isDone ? at : -1, latestDoneId: isDone ? r.id : null });
    }
  }

  const top = [...groups.values()]
    .sort((a, b) => b.count - a.count || b.recent - a.recent)
    .slice(0, limit);

  // Fetch the answer payload for only the top-N latest-completed batches (≤ limit rows).
  const ids = top.map((g) => g.latestDoneId).filter((id): id is string => id !== null);
  const resultRows = ids.length
    ? await db.select({ id: mmaBatch.id, result: mmaBatch.result }).from(mmaBatch).where(inArray(mmaBatch.id, ids))
    : [];
  const resultById = new Map(resultRows.map((r) => [r.id, r.result]));

  return top.map((g) => {
    const raw = g.latestDoneId ? resultById.get(g.latestDoneId) : null;
    if (raw) {
      try {
        const parsed = parseRecallEnvelope(raw);
        return { question: g.question, count: g.count, answerMd: parsed.summary, findings: parsed.findings, citationIds: parsed.citationIds };
      } catch {
        /* unparseable envelope — fall through to a bare FAQ (Refresh can re-run it) */
      }
    }
    return { question: g.question, count: g.count };
  });
}
