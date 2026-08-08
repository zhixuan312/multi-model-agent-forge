// @vitest-environment node
import { topFaqs } from '@/journal/faqs-core';
import { createMockDb } from '../test-utils/mock-db';

const TEAM = 'team-1';

const row = (query: string | null, daysAgo: number) => ({
  request: query ? { prompt: query } : {},
  createdAt: new Date(Date.UTC(2026, 0, 1) - daysAgo * 86_400_000),
});

/** A row from before the request field was harmonized onto `prompt`. */
const legacyRow = (query: string, daysAgo: number) => ({
  request: { query },
  createdAt: new Date(Date.UTC(2026, 0, 1) - daysAgo * 86_400_000),
});

describe('faqs-core topFaqs', () => {
  it('reads journal recall prompts from ops_mma_batch', async () => {
    const db = createMockDb({
      'select:ops_mma_batch': [
        row('How does auth work?', 1),
        row('how does auth work?', 2),
        row('What is a loop?', 1),
      ],
    });
    const faqs = await topFaqs(TEAM, 5, { db });
    expect(faqs[0]).toEqual({ question: 'How does auth work?', count: 2 });
    expect(faqs[1]).toEqual({ question: 'What is a loop?', count: 1 });
  });

  it('respects the limit', async () => {
    const db = createMockDb({
      'select:ops_mma_batch': ['a', 'b', 'c', 'd', 'e', 'f'].map((q, i) => row(q, i)),
    });
    expect(await topFaqs(TEAM, 2, { db })).toHaveLength(2);
  });

  it('skips null/blank prompts', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [row(null, 1), row('   ', 2), row('real q', 3)] });
    expect(await topFaqs(TEAM, 5, { db })).toEqual([{ question: 'real q', count: 1 }]);
  });

  /**
   * The journal page reads this same field as `prompt ?? query`, with a comment recording
   * that older rows used `query`. `topFaqs` read `prompt` alone — so a legacy row showed
   * its question under "recent recalls" and was invisible to the counts here, which
   * under-reported precisely the oldest and most-asked questions. Both now go through
   * `recallQuestionOf`.
   */
  it('counts legacy rows that stored the question as `query`', async () => {
    const db = createMockDb({
      'select:ops_mma_batch': [legacyRow('How does auth work?', 1), row('How does auth work?', 2)],
    });
    expect(await topFaqs(TEAM, 5, { db })).toEqual([{ question: 'How does auth work?', count: 2 }]);
  });

  it('skips a legacy row whose query is blank', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [legacyRow('  ', 1), row('real q', 2)] });
    expect(await topFaqs(TEAM, 5, { db })).toEqual([{ question: 'real q', count: 1 }]);
  });
});

/**
 * The "Top-5 frequently asked" list is TEAM data.
 *
 * `ops_mma_batch` holds every team's rows, and this query filtered on `route` and
 * `project_id` alone — no `team_id`. So the list aggregated recall queries across the
 * whole deployment: a brand-new team opened the Recall tab and saw another team's
 * questions. And a `Faq` carries `answerMd`, `findings` and `citationIds`, so the stored
 * ANSWERS came with them.
 *
 * The sibling reads on that page are scoped by construction — `listPins(me.id)` and
 * recent recalls by `dispatched_by` — which is why this one being unscoped was invisible:
 * everything either side of it was safe.
 *
 * Asserted on the BOUND VALUES of the WHERE, the same walk `runs-query.test.ts` and
 * `driver-lease.test.ts` use. Checking only that rows come back cannot see a missing
 * predicate; the mock returns its fixture either way.
 */
describe('topFaqs is scoped to one team', () => {
  function whereValues(db: ReturnType<typeof createMockDb>): string[] {
    const seen = new WeakSet<object>();
    const out: string[] = [];
    const walk = (v: unknown): void => {
      if (v === null || v === undefined) return;
      if (typeof v !== 'object') { out.push(String(v)); return; }
      if (seen.has(v)) return;
      seen.add(v);
      if (v.constructor?.name?.startsWith('Pg')) return;
      for (const child of Array.isArray(v) ? v : Object.values(v)) walk(child);
    };
    for (const c of db._calls.filter((c) => c.method === 'where')) walk(c.args);
    return out;
  }

  it('binds the caller’s team into the query', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [row('How does auth work?', 1)] });
    await topFaqs(TEAM, 5, { db });
    expect(
      whereValues(db),
      'without a team predicate this list shows every team’s recall questions and answers',
    ).toContain(TEAM);
  });

  it('still restricts to team-level journal_recall rows', async () => {
    // The team predicate must be ADDED to the existing filters, not replace them:
    // project-scoped recalls would bias the shared list, and other routes are not recalls.
    const db = createMockDb({ 'select:ops_mma_batch': [row('q', 1)] });
    await topFaqs(TEAM, 5, { db });
    expect(whereValues(db)).toContain('journal_recall');
  });
});
