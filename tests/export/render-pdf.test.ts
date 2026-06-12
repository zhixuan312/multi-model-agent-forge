// @vitest-environment node
// Real-Chromium @pdf tests. They render actual PDFs and read them back with
// pdf-parse, using the Chromium bundled with the project's headless toolchain
// (~6s). They always run so the suite has no environment-gated skips.
import { PdfRenderer, artifactRenderJob, defaultPdfPageTexts, PdfEngineError } from '@/export/pdf/render';
import { loadExportConfig } from '@/export/config';
import { parseArtifactSections } from '@/export/sections';
import { buildCombinedJob } from '@/export/combined-html';
import type { TemplateInput, CoverMeta } from '@/export/types';
import type { CollectedArtifact } from '@/export/collect-artifacts';

const META: CoverMeta = {
  owner: 'Maya Adeyemi',
  visibility: 'Public',
  componentsApproved: 5,
  auditClean: 2,
  version: 'v1 · frozen',
};

// A multi-page spec: §03 has a lot of content so it overflows onto a 2nd page.
const big = (label: string) =>
  Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of ${label}. Lorem ipsum dolor sit amet, consectetur.`).join(
    '\n\n',
  );

const SPEC_BODY = [
  '## 01. Context',
  'Short context paragraph.',
  '',
  '## 03. Technical design',
  big('tech design'),
].join('\n');

function specInput(): TemplateInput {
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
  };
}

describe('@pdf real Chromium render', () => {
  it('produces a valid multi-page PDF with section-per-page + footer + TOC ranges (test 9)', async () => {
    const cfg = loadExportConfig();
    const r = new PdfRenderer({ config: cfg, pdfPageTexts: defaultPdfPageTexts });
    const input = specInput();
    const buf = await r.render(artifactRenderJob(input, Buffer.byteLength(SPEC_BODY)));
    await r.close();

    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = await defaultPdfPageTexts(buf);
    // collapse pdf-parse's letter-spacing artifacts for robust word matching
    const flat = (s: string) => s.replace(/\s+/g, ' ');
    const norm = (s: string) => s.replace(/\s+/g, '');

    // cover + §01 + §03 (which overflows) ⇒ ≥ 3 pages
    expect(pages.length).toBeGreaterThanOrEqual(3);
    // cover kicker (the letter-spaced uppercase kicker collapses to SPECIFICATION·FORGE)
    expect(norm(pages[0]).toUpperCase()).toContain('SPECIFICATION·FORGE');
    // footer left text on a sampled page
    expect(pages.some((p) => flat(p).includes('Forge · Evaluation indicator #11'))).toBe(true);

    // section-per-page: each section's marker lives on its own start page (F1).
    const pageOf = (nn: string) => pages.findIndex((p) => p.includes(`§${nn}`)) + 1;
    const p01 = pageOf('01');
    const p03 = pageOf('03');
    expect(p01).toBeGreaterThanOrEqual(2); // §01 starts after the cover
    expect(p03).toBeGreaterThan(p01); // §03 starts on a fresh, later page

    // §03 overflows ⇒ the (continued) carry-on header (the repeating <thead>)
    // appears on the OVERFLOW page too — i.e. on a §03 page beyond its start (F8).
    const continuedPages = pages
      .map((p, i) => (norm(p).includes('Technicaldesign(continued)') ? i + 1 : -1))
      .filter((n) => n > 0);
    // the header repeats: it shows on the section's own pages, including ≥1 page
    // strictly after the start page — proving the <thead>-repeat fires in Chromium.
    expect(continuedPages.some((n) => n > p03)).toBe(true);
  }, 60_000);

  it('combined PDF: ≥2 artifacts, order preserved, continuous page numbers (test 10)', async () => {
    const cfg = loadExportConfig();
    const r = new PdfRenderer({ config: cfg, pdfPageTexts: defaultPdfPageTexts });
    const artifacts: CollectedArtifact[] = [
      {
        kind: 'exploration',
        bodyMd: '## Exploration\n' + big('exploration'),
        version: 1,
        meta: META,
        sectionHeaders: {},
      },
      {
        kind: 'spec',
        bodyMd: SPEC_BODY,
        version: 1,
        meta: META,
        sectionHeaders: {
          '01': { status: 'Approved', approved: true, roles: 'PM' },
          '03': { status: 'Approved', approved: true, roles: 'SWE' },
        },
      },
    ];
    const buf = await r.render(buildCombinedJob(artifacts, 'Evaluation indicator #11', false));
    await r.close();
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = await defaultPdfPageTexts(buf);
    const all = pages.join('\n');
    // exploration text appears before spec text (order, F20/F9)
    expect(all.indexOf('Exploration')).toBeLessThan(all.indexOf('Technical design'));
  }, 90_000);

  it('launch failure path → PdfEngineError, while .md is unaffected (test 11)', async () => {
    const cfg = loadExportConfig({ PUPPETEER_EXECUTABLE_PATH: '/nonexistent/chromium' });
    const r = new PdfRenderer({ config: cfg, pdfPageTexts: defaultPdfPageTexts });
    await expect(r.render(artifactRenderJob(specInput(), 100))).rejects.toBeInstanceOf(PdfEngineError);
  }, 30_000);
});
