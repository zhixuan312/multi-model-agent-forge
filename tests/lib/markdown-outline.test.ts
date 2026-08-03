// @vitest-environment node
import { parseMarkdownOutline } from '@/lib/markdown-outline';
import { parseSpecSections } from '@/spec/spec-file-ops';
import { parsePlanSections } from '@/plan/plan-file-ops';

const ANY_SECTION = /^### .+/;

/**
 * These cases were built as a differential harness against the two parsers this module
 * replaced (spec + plan, checked over every real spec/plan/exploration on disk as well).
 * Kept as direct assertions so the behaviour stays pinned without the old code around.
 */
describe('parseMarkdownOutline', () => {
  it('splits ### sections and attributes each to its ## container', () => {
    const out = parseMarkdownOutline('## Context\n\n### Background\n\nbody\n\n### Scope\n\nmore', { itemHeading: ANY_SECTION });
    expect(out.map((s) => [s.container, s.heading, s.body])).toEqual([
      ['Context', '### Background', 'body'],
      ['Context', '### Scope', 'more'],
    ]);
  });

  it('never treats a heading inside a ``` fence as a heading', () => {
    const md = '## A\n\n### S\n\n```\n## NotAHeading\n### AlsoNot\n```\n\ntail';
    const out = parseMarkdownOutline(md, { itemHeading: ANY_SECTION });
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain('## NotAHeading');
    expect(out[0].body).toContain('tail');
  });

  it('an unclosed fence swallows the rest of the document rather than splitting it', () => {
    const out = parseMarkdownOutline('## A\n\n### S\n\n```\n## Inside\n', { itemHeading: ANY_SECTION });
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain('## Inside');
  });

  it('startLine/endLine bound the section exactly — the splice contract', () => {
    const md = '## A\n\n### One\n\nbody one\n\n### Two\n\nbody two';
    const lines = md.split('\n');
    const [first, second] = parseMarkdownOutline(md, { itemHeading: ANY_SECTION });
    expect(lines[first.startLine]).toBe('### One');
    expect(lines[second.startLine]).toBe('### Two');
    expect(first.endLine).toBe(second.startLine - 1);
    expect(second.endLine).toBe(lines.length - 1);
  });

  it('a section before any container has an empty container', () => {
    expect(parseMarkdownOutline('### Loose\n\nbody', { itemHeading: ANY_SECTION })[0].container).toBe('');
  });

  it('back-to-back containers do not emit an empty section', () => {
    expect(parseMarkdownOutline('## A\n## B\n\n### S\n\nbody', { itemHeading: ANY_SECTION })).toHaveLength(1);
  });

  it('a ## line with no space is not a container', () => {
    expect(parseMarkdownOutline('##NoSpace\n\n### S\n\nbody', { itemHeading: ANY_SECTION })[0].container).toBe('');
  });

  it('returns nothing for an empty document or a container with no content', () => {
    expect(parseMarkdownOutline('', { itemHeading: ANY_SECTION })).toEqual([]);
    expect(parseMarkdownOutline('## Context', { itemHeading: ANY_SECTION })).toEqual([]);
  });

  describe('implicitSection', () => {
    it('turns unheaded prose under a container into a section named after it', () => {
      const [s] = parseMarkdownOutline('## Context\n\nsome prose', { itemHeading: ANY_SECTION, implicitSection: true });
      expect(s.heading).toBe('### Context');
      expect(s.body).toBe('some prose');
    });

    it('is off by default — the same prose yields nothing', () => {
      expect(parseMarkdownOutline('## Context\n\nsome prose', { itemHeading: ANY_SECTION })).toEqual([]);
    });
  });
});

describe('the two callers keep their own heading rules', () => {
  it('spec accepts any ### heading', () => {
    expect(parseSpecSections('## C\n\n### Anything At All\n\nbody')).toHaveLength(1);
  });

  it('plan takes only task-shaped headings, so a ### Notes stays inside its task', () => {
    const md = '## Phase 1\n\n### Task 1: do it\n\nbody\n\n### Notes\n\nnote body';
    const out = parsePlanSections(md);
    expect(out).toHaveLength(1);
    expect(out[0].heading).toBe('### Task 1: do it');
    expect(out[0].body).toContain('### Notes');
  });

  it('plan reports an unphased task as undefined, not an empty string', () => {
    expect(parsePlanSections('### Task 1: x\n\nbody')[0].phase).toBeUndefined();
  });

  it('spec reports an uncontained section as an empty string', () => {
    expect(parseSpecSections('### Loose\n\nbody')[0].component).toBe('');
  });
});

/**
 * `.test()` on a `g`-flagged RegExp resumes from `lastIndex`, so it matches every OTHER
 * heading and returns false in between — the sections in the gaps get absorbed into their
 * predecessor's body, and `startLine`/`endLine` shift with them. `replaceTaskSection`
 * splices a file using those numbers, so this would corrupt a plan.md rather than merely
 * return the wrong shape. Neither caller passes a global regex; nothing stopped one from
 * starting to.
 */
describe('a stateful caller-supplied heading regex', () => {
  // ADJACENT headings, deliberately. A non-matching body line between them resets
  // `lastIndex` back to 0, so a fixture with bodies hides the bug entirely — the first
  // version of this test did exactly that and passed against the unfixed parser.
  const md = ['### One', '### Two', '### Three', 'c'].join('\n');

  it('gives the same outline whether or not the regex is global', () => {
    const plain = parseMarkdownOutline(md, { itemHeading: /^### .+/ });
    const global = parseMarkdownOutline(md, { itemHeading: /^### .+/g });
    expect(plain.map((s) => s.heading)).toEqual(['### One', '### Two', '### Three']);
    expect(global).toEqual(plain);
  });

  it('and the same for a sticky one', () => {
    expect(parseMarkdownOutline(md, { itemHeading: /^### .+/y }))
      .toEqual(parseMarkdownOutline(md, { itemHeading: /^### .+/ }));
  });

  it('does not mutate the caller’s regex', () => {
    const re = /^### .+/g;
    parseMarkdownOutline(md, { itemHeading: re });
    expect(re.lastIndex).toBe(0);
  });
});
