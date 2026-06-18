// @vitest-environment node
import { topFaqs } from '@/journal/faqs-core';
import { createMockDb } from '../test-utils/mock-db';

const row = (target: string | null, daysAgo: number) => ({
  target,
  createdAt: new Date(Date.UTC(2026, 0, 1) - daysAgo * 86_400_000),
});

describe('faqs-core topFaqs', () => {
  it('ranks by frequency over normalized queries, ties by most-recent, displays recent casing', async () => {
    const db = createMockDb({
      'select:ops_action_log': [
        row('How does auth work?', 1), // most-recent of the auth group
        row('how does auth work?', 2),
        row('  How does auth work? ', 3), // → normalized group count 3
        row('What is a loop?', 1),
        row('What is a loop?', 5), // count 2
        row('Single question', 4), // count 1
      ],
    });
    const faqs = await topFaqs(5, { db });
    expect(faqs[0]).toEqual({ question: 'How does auth work?', count: 3 });
    expect(faqs[1]).toEqual({ question: 'What is a loop?', count: 2 });
    expect(faqs[2]).toEqual({ question: 'Single question', count: 1 });
  });

  it('respects the limit', async () => {
    const db = createMockDb({
      'select:ops_action_log': ['a', 'b', 'c', 'd', 'e', 'f'].map((q, i) => row(q, i)),
    });
    expect(await topFaqs(2, { db })).toHaveLength(2);
  });

  it('skips null/blank targets', async () => {
    const db = createMockDb({ 'select:ops_action_log': [row(null, 1), row('   ', 2), row('real q', 3)] });
    expect(await topFaqs(5, { db })).toEqual([{ question: 'real q', count: 1 }]);
  });
});
