import { dedupeByQuestion } from '@/components/forge/journal/RecallTab';

const q = (question: string, id: string) => ({ id, question });

describe('dedupeByQuestion — no repeat within a section', () => {
  it('collapses identical questions to one, keeping the first (freshest) occurrence', () => {
    const recents = [q('Explain the tech stack', 'r3'), q('Explain the tech stack', 'r2'), q('Explain the tech stack', 'r1')];
    const out = dedupeByQuestion(recents, (r) => r.question);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('r3'); // newest kept
  });

  it('is case- and whitespace-insensitive', () => {
    const out = dedupeByQuestion(
      [q('  Explain the tech stack  ', 'a'), q('explain THE tech STACK', 'b')],
      (r) => r.question,
    );
    expect(out).toHaveLength(1);
  });

  it('keeps genuinely different questions', () => {
    const out = dedupeByQuestion([q('A?', '1'), q('B?', '2'), q('A?', '3')], (r) => r.question);
    expect(out.map((r) => r.id)).toEqual(['1', '2']);
  });
});
