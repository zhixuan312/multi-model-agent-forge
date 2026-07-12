// @vitest-environment node
import { topFaqs } from '@/journal/faqs-core';
import { createMockDb } from '../test-utils/mock-db';

const row = (query: string | null, daysAgo: number) => ({
  request: query ? { prompt: query } : {},
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
});
