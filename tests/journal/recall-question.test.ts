// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recallQuestionOf } from '@/journal/recall-question';

/**
 * One accessor for the question on a `journal_recall` batch request.
 *
 * It was read two ways over the same rows: the journal page took `prompt ?? query` (with a
 * comment recording that older rows used `query`), and `topFaqs` took `prompt` alone. So a
 * legacy row appeared under "recent recalls" with its question and contributed nothing to
 * the FAQ counts — under-reporting exactly the oldest, most-asked questions, and doing it
 * invisibly, because both surfaces looked populated.
 */
describe('recallQuestionOf', () => {
  it('reads the current field', () => {
    expect(recallQuestionOf({ prompt: 'How does auth work?' })).toBe('How does auth work?');
  });

  it('falls back to the legacy field', () => {
    expect(recallQuestionOf({ query: 'How does auth work?' })).toBe('How does auth work?');
  });

  it('prefers the current field when a row carries both', () => {
    expect(recallQuestionOf({ prompt: 'new', query: 'old' })).toBe('new');
  });

  it('trims, so a padded value groups with its unpadded twin', () => {
    expect(recallQuestionOf({ prompt: '  spaced  ' })).toBe('spaced');
    expect(recallQuestionOf({ query: '  spaced  ' })).toBe('spaced');
  });

  it('returns empty for anything that is not a question', () => {
    for (const req of [null, undefined, {}, { prompt: 42 }, { query: {} }, { prompt: '   ' }]) {
      expect(recallQuestionOf(req)).toBe('');
    }
  });
});

/** Both readers must go through it, or the drift simply comes back. */
describe('the two recall surfaces share the accessor', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it.each(['src/journal/faqs-core.ts', 'app/(app)/journal/page.tsx'])('%s uses recallQuestionOf', (file) => {
    expect(read(file)).toContain('recallQuestionOf');
  });

  it('neither re-reads the raw fields itself', () => {
    for (const file of ['src/journal/faqs-core.ts', 'app/(app)/journal/page.tsx']) {
      expect(read(file), `${file} reaches past the accessor`).not.toMatch(/req\.(prompt|query) as string/);
    }
  });
});
