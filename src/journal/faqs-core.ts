/**
 * FAQ core (Spec: journal recall pins). The Recall tab's "Top-5 frequently asked"
 * is auto-derived from recall history — no curation, no table of its own.
 *
 * Source: `ops_action_log` rows where `action = 'journal_recall'` AND
 * `project_id IS NULL` (team-level recalls; project-scoped recalls would bias the
 * shared list). The recall route writes the original query to `target`.
 *
 * The most-recent N recall rows are fetched via the partial index
 * (`ops_action_log (created_at desc) where action='journal_recall'`) — a bounded
 * scan — then grouped by normalized query (lowercased/trimmed) in JS, ranked by
 * count desc then most-recent, top `limit`. JS grouping keeps the ranking
 * unit-testable; the bound keeps the read cheap.
 */
import { and, eq, isNull, desc } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { actionLog } from '@/db/schema/ops';

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
    .select({ target: actionLog.target, createdAt: actionLog.createdAt })
    .from(actionLog)
    .where(and(eq(actionLog.action, 'journal_recall'), isNull(actionLog.projectId)))
    .orderBy(desc(actionLog.createdAt))
    .limit(SCAN_CAP);

  const groups = new Map<string, { question: string; count: number; recent: number }>();
  for (const r of rows) {
    const question = (r.target ?? '').trim();
    if (!question) continue;
    const key = question.toLowerCase();
    const at = r.createdAt instanceof Date ? r.createdAt.getTime() : new Date(r.createdAt as unknown as string).getTime();
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      if (at > g.recent) {
        g.recent = at;
        g.question = question; // display the most-recent casing
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
