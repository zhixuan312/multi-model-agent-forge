import { DIRECTION_SECTIONS, PARTS } from '@/content/direction-sections';
import { GUIDE_FIRST_SECTION_ID, GUIDE_NAV_SECTIONS, GUIDE_PARTS } from '@/content/guide-nav';

/**
 * The rail projection is a hand-maintained duplicate — kept lightweight so the
 * Sidebar never pulls the manual's prose into every route's bundle. These
 * assertions are the only thing stopping it from drifting from the real content.
 */
describe('guide-nav projection', () => {
  it('matches DIRECTION_SECTIONS exactly, in order', () => {
    expect(GUIDE_NAV_SECTIONS).toEqual(
      DIRECTION_SECTIONS.map(({ id, part, title }) => ({ id, part, title })),
    );
  });

  it('matches the ordered part list', () => {
    expect(GUIDE_PARTS).toEqual(PARTS);
  });

  it('lands on the first section', () => {
    expect(GUIDE_FIRST_SECTION_ID).toBe(DIRECTION_SECTIONS[0].id);
  });

  it('imports no content module, so the Sidebar stays off the manual bundle', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/content/guide-nav.ts', 'utf8');
    expect(source).not.toMatch(/(?:from|import|require)\s*\(?\s*['"]/);
  });
});
