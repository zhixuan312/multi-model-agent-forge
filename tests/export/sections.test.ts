// @vitest-environment node
import {
  parseArtifactSections,
  markdownToSafeHtml,
  extractMermaid,
  hasMermaid,
} from '@/export/sections';

const SPEC_BODY = [
  '## 01. Context',
  '',
  'The eval system ships ten indicators.',
  '',
  '## 03. Technical design',
  '',
  'Register indicator11 behind a flag.',
  '',
  '```mermaid',
  'flowchart LR',
  'A-->B',
  '```',
  '',
].join('\n');

describe('sections — spec split (F2/F21)', () => {
  it('splits a spec body on ## NN. keyed by NN, in order', () => {
    const secs = parseArtifactSections(SPEC_BODY, 'spec');
    expect(secs.map((s) => s.nn)).toEqual(['01', '03']);
    expect(secs[0].title).toBe('Context');
    expect(secs[1].title).toBe('Technical design');
  });

  // The fallback is not an edge case: mma-spec emits `## <component>`, so it is the
  // path EVERY real spec takes. These assert the resulting sections, not just a count —
  // "length >= 1" passed equally well when the split was wrong.
  it('a spec with unnumbered ## headings splits on them, keeping the titles', () => {
    const sections = parseArtifactSections('## Context\n\nbody a\n\n## Problem\n\nbody b', 'spec');
    expect(sections.map((s) => s.title)).toEqual(['Context', 'Problem']);
    expect(sections[0].bodyMd).toContain('body a');
  });

  it('a spec with NO headings at all yields one section rather than throwing', () => {
    const sections = parseArtifactSections('# Title\n\nno numbered headings here', 'spec');
    expect(sections).toHaveLength(1);
    expect(sections[0].bodyMd).toContain('no numbered headings here');
  });

  it('a single-digit "## 1." is NOT the numbered form (two digits required) — generic split', () => {
    const sections = parseArtifactSections('## 1. one\n\nbody', 'spec');
    expect(sections.map((s) => s.title)).toEqual(['1. one']);
  });
});

describe('sections — non-spec split (F5)', () => {
  const PLAN = ['Intro lead text.', '', '## Phase one', 'do a', '', '## Phase two', 'do b'].join('\n');

  it('splits a non-spec doc on every ## plus a lead section', () => {
    const secs = parseArtifactSections(PLAN, 'plan');
    // lead + 2 headings = 3 page-able sections
    expect(secs).toHaveLength(3);
    expect(secs.map((s) => s.title)).toEqual(['', 'Phase one', 'Phase two']);
  });

  it('a non-spec doc with no ## collapses to one group', () => {
    const secs = parseArtifactSections('just a paragraph, no headings', 'exploration');
    expect(secs).toHaveLength(1);
  });

  it('does not require the NN grammar for non-spec', () => {
    expect(() => parseArtifactSections('## Anything goes\n\nbody', 'journal')).not.toThrow();
  });
});

describe('sections — mermaid extraction', () => {
  it('extracts mermaid block sources', () => {
    const secs = parseArtifactSections(SPEC_BODY, 'spec');
    const tech = secs.find((s) => s.nn === '03')!;
    expect(tech.mermaid).toHaveLength(1);
    expect(tech.mermaid[0].source).toContain('flowchart LR');
  });

  it('hasMermaid / extractMermaid helpers', () => {
    expect(hasMermaid('```mermaid\nflowchart\n```')).toBe(true);
    expect(hasMermaid('no diagrams')).toBe(false);
    expect(extractMermaid('```mermaid\ngraph TD\n```')).toHaveLength(1);
  });
});

describe('sections — HTML sanitization (F13)', () => {
  it('strips <script>, on* handlers, and remote/file <img>', () => {
    const html = markdownToSafeHtml(
      [
        '# Heading',
        '<script>alert(1)</script>',
        '<img src="http://evil/x" onerror="alert(2)">',
        '<img src="file:///etc/passwd">',
        '**bold**',
      ].join('\n\n'),
    );
    expect(/<script/i.test(html)).toBe(false);
    expect(/onerror/i.test(html)).toBe(false);
    expect(/http:\/\/evil/i.test(html)).toBe(false);
    expect(/file:\/\//i.test(html)).toBe(false);
    expect(html).toContain('<strong>bold</strong>');
  });

  it('preserves a mermaid fence as a code block in HTML when not rendered', () => {
    const html = markdownToSafeHtml('```mermaid\nflowchart LR\nA-->B\n```');
    expect(html).toMatch(/language-mermaid/);
  });

  it('preserves GFM tables', () => {
    const html = markdownToSafeHtml('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
  });
});
