// @vitest-environment node
import {
  parseArtifactSections,
  markdownToSafeHtml,
  extractMermaid,
  hasMermaid,
  SpecHeadingContractError,
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

  it('includeComponents=["01"] keeps ONLY §01 and drops §03 (F2)', () => {
    const secs = parseArtifactSections(SPEC_BODY, 'spec', { includeComponents: ['01'] });
    expect(secs.map((s) => s.nn)).toEqual(['01']);
  });

  it('empty includeComponents keeps all', () => {
    const secs = parseArtifactSections(SPEC_BODY, 'spec', { includeComponents: [] });
    expect(secs.map((s) => s.nn)).toEqual(['01', '03']);
  });

  it('includeComponents entries matching no section are silently ignored (intersection)', () => {
    const secs = parseArtifactSections(SPEC_BODY, 'spec', { includeComponents: ['01', '99'] });
    expect(secs.map((s) => s.nn)).toEqual(['01']);
  });

  it('zero ## NN. matches in a spec throws SpecHeadingContractError (F21 fail-loud)', () => {
    expect(() => parseArtifactSections('# Title\n\nno numbered headings here', 'spec')).toThrow(
      SpecHeadingContractError,
    );
  });

  it('a section title without a trailing period is NOT a spec section', () => {
    // `## 1. x` (single digit) and `## Foo` (no number) must not match the grammar.
    expect(() => parseArtifactSections('## 1. one\n\nbody', 'spec')).toThrow(SpecHeadingContractError);
  });

  it('SpecHeadingContractError carries a 200-char sample', () => {
    try {
      parseArtifactSections('x'.repeat(500), 'spec');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SpecHeadingContractError);
      expect((e as SpecHeadingContractError).sample).toHaveLength(200);
    }
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
    expect(() => parseArtifactSections('## Anything goes\n\nbody', 'review')).not.toThrow();
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
