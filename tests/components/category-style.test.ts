// @vitest-environment node
import { categoryStyle } from '@/components/forge/journal/category-style';
import { LEARNING_CATEGORIES } from '@/db/enums';

describe('categoryStyle', () => {
  it('gives every category in the taxonomy a distinct tint', () => {
    const tints = LEARNING_CATEGORIES.map((c) => categoryStyle(c));
    expect(new Set(tints).size).toBe(LEARNING_CATEGORIES.length);
    expect(tints.every((t) => t.length > 0)).toBe(true);
  });

  it('falls back to the neutral tint for a category not in the taxonomy', () => {
    // node.type comes from frontmatter on disk, so it can be anything. Indexing the map
    // directly used to yield undefined here and render an unstyled chip.
    expect(categoryStyle('something-else')).toBe(categoryStyle('style'));
    expect(categoryStyle('')).toBe(categoryStyle('style'));
    expect(categoryStyle(null)).toBe(categoryStyle('style'));
    expect(categoryStyle(undefined)).toBe(categoryStyle('style'));
  });
});
