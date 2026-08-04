// @vitest-environment node
import { topFaqs } from '@/journal/faqs-core';
import { createMockDb } from '../test-utils/mock-db';

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
    const faqs = await topFaqs(5, { db });
    expect(faqs[0]).toEqual({ question: 'How does auth work?', count: 2 });
    expect(faqs[1]).toEqual({ question: 'What is a loop?', count: 1 });
  });

  it('respects the limit', async () => {
    const db = createMockDb({
      'select:ops_mma_batch': ['a', 'b', 'c', 'd', 'e', 'f'].map((q, i) => row(q, i)),
    });
    expect(await topFaqs(2, { db })).toHaveLength(2);
  });

  it('skips null/blank prompts', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [row(null, 1), row('   ', 2), row('real q', 3)] });
    expect(await topFaqs(5, { db })).toEqual([{ question: 'real q', count: 1 }]);
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
    expect(await topFaqs(5, { db })).toEqual([{ question: 'How does auth work?', count: 2 }]);
  });

  it('skips a legacy row whose query is blank', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [legacyRow('  ', 1), row('real q', 2)] });
    expect(await topFaqs(5, { db })).toEqual([{ question: 'real q', count: 1 }]);
  });
});
