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
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';

export interface FaqsDeps {
  db?: Db;
}

export interface Faq {
  question: string;
  count: number;
}

/** Upper bound on rows aggregated — the most-recent recall queries. */
const SCAN_CAP = 1000;

export async function topFaqs(limit = 5, deps: FaqsDeps = {}): Promise<Faq[]> {
  const db = deps.db ?? getDb();
  const rows = await db
    .select({ request: mmaBatch.request, createdAt: mmaBatch.createdAt })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.route, 'journal_recall'), isNull(mmaBatch.projectId)))
    .orderBy(desc(mmaBatch.createdAt))
    .limit(SCAN_CAP);

  const groups = new Map<string, { question: string; count: number; recent: number }>();
  for (const r of rows) {
    const question = String((r.request as { prompt?: string } | null)?.prompt ?? '').trim();
    if (!question) continue;
    const key = question.toLowerCase();
    const at = r.createdAt instanceof Date ? r.createdAt.getTime() : new Date(r.createdAt as unknown as string).getTime();
    const prev = groups.get(key);
    if (prev) {
      prev.count += 1;
      if (at > prev.recent) {
        prev.recent = at;
        prev.question = question;
      }
    } else {
      groups.set(key, { question, count: 1, recent: at });
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.recent - a.recent)
    .slice(0, limit)
    .map((g) => ({ question: g.question, count: g.count }));
}
