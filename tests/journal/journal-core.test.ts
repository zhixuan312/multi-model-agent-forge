import { mapCategoryToType, mapSourceToOrigin, formatTags, parseTags } from '@/journal/journal-core';

describe('mapCategoryToType', () => {
  it('maps decision → decision', () => expect(mapCategoryToType('decision')).toBe('decision'));
  it('maps design → decision', () => expect(mapCategoryToType('design')).toBe('decision'));
  it('maps behavior → insight', () => expect(mapCategoryToType('behavior')).toBe('insight'));
  it('maps process → insight', () => expect(mapCategoryToType('process')).toBe('insight'));
  it('maps knowledge → insight', () => expect(mapCategoryToType('knowledge')).toBe('insight'));
  it('maps style → insight', () => expect(mapCategoryToType('style')).toBe('insight'));
  it('maps unknown → insight (fallback)', () => expect(mapCategoryToType('whatever')).toBe('insight'));
});

describe('mapSourceToOrigin', () => {
  it('maps Exploration → exploration', () => expect(mapSourceToOrigin('Exploration')).toBe('exploration'));
  it('maps Spec → spec', () => expect(mapSourceToOrigin('Spec')).toBe('spec'));
  it('maps Plan → spec', () => expect(mapSourceToOrigin('Plan')).toBe('spec'));
  it('maps Execute → spec', () => expect(mapSourceToOrigin('Execute')).toBe('spec'));
  it('maps Review → spec', () => expect(mapSourceToOrigin('Review')).toBe('spec'));
  it('maps Manual → spec', () => expect(mapSourceToOrigin('Manual')).toBe('spec'));
  it('maps unknown → spec (fallback)', () => expect(mapSourceToOrigin('whatever')).toBe('spec'));
});

describe('formatTags + parseTags', () => {
  it('round-trips category + source', () => {
    const tagged = formatTags('Some learning text', 'behavior', 'Execute');
    expect(tagged).toBe('[category:behavior][source:Execute] Some learning text');
    const { category, source, text } = parseTags(tagged);
    expect(category).toBe('behavior');
    expect(source).toBe('Execute');
    expect(text).toBe('Some learning text');
  });

  it('parses text without tags', () => {
    const { category, source, text } = parseTags('Plain text without tags');
    expect(category).toBeNull();
    expect(source).toBeNull();
    expect(text).toBe('Plain text without tags');
  });

  it('handles empty text', () => {
    const tagged = formatTags('', 'decision', 'Spec');
    const { category, source, text } = parseTags(tagged);
    expect(category).toBe('decision');
    expect(source).toBe('Spec');
    expect(text).toBe('');
  });
});
