// @vitest-environment node
import {
  renderArtifactHtml,
  coverKicker,
  footerTemplate,
  PDF_MARGINS,
} from '@/export/pdf/template';
import { parseArtifactSections } from '@/export/sections';
import type { TemplateInput, CoverMeta } from '@/export/types';

const META: CoverMeta = {
  owner: 'Maya Adeyemi',
  visibility: 'Public',
  componentsApproved: 5,
  auditClean: 2,
  version: 'v1 · locked',
};

const SPEC_BODY = [
  '## 01. Context',
  'The eval system ships ten indicators.',
  '',
  '## 03. Technical design',
  'Register indicator11 behind a flag.',
  '',
  '```mermaid',
  'flowchart LR',
  'A-->B',
  '```',
].join('\n');

function specInput(over: Partial<TemplateInput> = {}): TemplateInput {
  return {
    kind: 'spec',
    projectName: 'Evaluation indicator #11',
    lede: 'Add an 11th evaluation indicator.',
    meta: META,
    sections: parseArtifactSections(SPEC_BODY, 'spec'),
    sectionHeaders: {
      '01': { status: 'Approved', approved: true, roles: 'business · PM' },
      '03': { status: 'Approved', approved: true, roles: 'SWE' },
    },
    mermaidAsDiagram: false,
    ...over,
  };
}

describe('template — cover + meta + TOC (F1/F3/F10)', () => {
  it('emits the kind-specific kicker for all four kinds (F10)', () => {
    expect(coverKicker('spec')).toBe('Specification · Forge');
    expect(coverKicker('exploration')).toBe('Exploration · Forge');
    expect(coverKicker('plan')).toBe('Plan · Forge');
    expect(coverKicker('review')).toBe('Review · Forge');
    const html = renderArtifactHtml(specInput());
    expect(html).toContain('Specification · Forge');
  });

  it('renders the title, lede, and all five meta fields', () => {
    const html = renderArtifactHtml(specInput());
    expect(html).toContain('Evaluation indicator #11');
    expect(html).toContain('Add an 11th evaluation indicator.');
    expect(html).toContain('Maya Adeyemi');
    expect(html).toContain('Public');
    expect(html).toContain('5 approved');
    expect(html).toContain('clean ×2');
    expect(html).toContain('v1 · locked');
  });

  it('renders one Contents TOC row per included section', () => {
    const html = renderArtifactHtml(specInput());
    expect(html).toContain('Contents');
    expect((html.match(/class="toc-row"/g) ?? []).length).toBe(2);
  });

  it('pass-1 (no tocRanges) renders BLANK page cells; pass-2 renders p.N / p.N–M', () => {
    const blank = renderArtifactHtml(specInput({ tocRanges: undefined }));
    expect(blank).toMatch(/data-toc="01"><\/span>/); // empty cell
    const filled = renderArtifactHtml(
      specInput({ tocRanges: { '01': { startPage: 2, endPage: 2 }, '03': { startPage: 4, endPage: 5 } } }),
    );
    expect(filled).toContain('>p.2</span>');
    expect(filled).toContain('>p.4–5</span>');
  });

  it('an unresolved TOC marker renders a blank cell while others fill (F31)', () => {
    const html = renderArtifactHtml(specInput({ tocRanges: { '01': { startPage: 2, endPage: 2 } } }));
    expect(html).toContain('>p.2</span>'); // 01 filled
    expect(html).toMatch(/data-toc="03"><\/span>/); // 03 blank (unresolved)
  });
});

describe('template — section pagination + headers (F1/F8)', () => {
  it('each section is page-break-before via the table wrapper', () => {
    const html = renderArtifactHtml(specInput());
    expect((html.match(/table class="section"/g) ?? []).length).toBe(2);
  });

  it('the continued (thead) header markup is present per section (F8)', () => {
    const html = renderArtifactHtml(specInput());
    expect(html).toContain('<thead>');
    expect(html).toContain('(continued)');
  });

  it('a spec §03 header emits the approved chip + dotted roles (F1)', () => {
    const html = renderArtifactHtml(specInput());
    expect(html).toContain('✓ approved');
    expect(html).toContain('SWE');
    expect(html).toContain('business · PM');
  });

  it('a non-approved component renders its true status, not approved (F1)', () => {
    const html = renderArtifactHtml(
      specInput({
        sectionHeaders: {
          '01': { status: 'Gathering', approved: false, roles: '' },
          '03': { status: 'Approved', approved: true, roles: 'SWE' },
        },
      }),
    );
    expect(html).toContain('Gathering');
    // §01 must NOT claim approved
    const seg01 = html.slice(html.indexOf('data-section="01"'), html.indexOf('data-section="03"'));
    expect(seg01).not.toContain('✓ approved');
  });
});

describe('template — non-spec has no badge/roles, footer, margins', () => {
  it('non-spec sections emit no badge/roles chip', () => {
    const html = renderArtifactHtml({
      kind: 'plan',
      projectName: 'P',
      lede: '',
      meta: { ...META, componentsApproved: 0, auditClean: 0 },
      sections: parseArtifactSections('## Phase one\nbody', 'plan'),
      mermaidAsDiagram: false,
    });
    // Inspect the section markup only (the cover/CSS legitimately mention these words).
    const section = html.slice(html.indexOf('table class="section"'));
    expect(section).not.toContain('class="approved"');
    expect(section).not.toContain('class="status-chip"');
    expect(section).not.toContain('class="roles"');
  });

  it('footer template carries Forge · <project> + page-number placeholders', () => {
    const f = footerTemplate('My Project');
    expect(f).toContain('Forge · My Project');
    expect(f).toContain('class="pageNumber"');
    expect(f).toContain('class="totalPages"');
  });

  it('A4 margins are pinned (F3)', () => {
    expect(PDF_MARGINS).toEqual({ top: '14mm', bottom: '12mm', left: '13mm', right: '13mm' });
    const html = renderArtifactHtml(specInput());
    expect(html).toContain('size: A4');
  });
});

describe('template — mermaid mode', () => {
  it('mermaidAsDiagram=false keeps the fence as a code block', () => {
    const html = renderArtifactHtml(specInput({ mermaidAsDiagram: false }));
    expect(html).toContain('language-mermaid');
    expect(html).not.toContain('class="mermaid"');
  });

  it('mermaidAsDiagram=true converts the fence to a .mermaid div', () => {
    const html = renderArtifactHtml(specInput({ mermaidAsDiagram: true }));
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('flowchart LR');
  });
});
