/**
 * Stage-2 of the PDF pipeline (Spec 8 §"Build the Forge HTML template",
 * F1/F3/F10). Pure functions: `sections + meta + tocRanges? → HTML string`.
 *
 * Mirrors `export-pdf-pages.html`:
 *  - page 1 = cover (kicker + serif title + italic lede + 5-field meta row +
 *    Contents TOC), bounded by 2px ink rules;
 *  - each section = `page-break-before: always` so a component starts fresh;
 *  - a long section overflows naturally; a `<thead>`-repeat carries a
 *    `Title (continued)` header onto overflow pages (F8, the robust approach);
 *  - footers via Puppeteer header/footer templates (page numbers live there).
 *
 * Print CSS is A4, self-contained (no Google-Fonts egress — F19). Fonts use the
 * Newsreader/Spline families with web-safe fallbacks so the PDF renders offline.
 */
import type {
  ExportKind,
  CoverMeta,
  SectionHeaderMap,
  TocRanges,
  TemplateInput,
} from '@/export/types';
import type { ParsedSection } from '@/export/sections';

/** A4 page margins (F3), derived from the mockup `.page` padding. */
export const PDF_MARGINS = { top: '14mm', bottom: '12mm', left: '13mm', right: '13mm' } as const;

const KICKER: Record<ExportKind, string> = {
  spec: 'Specification · Forge',
  exploration: 'Exploration · Forge',
  plan: 'Plan · Forge',
  journal: 'Journal · Forge',
};

/** The cover kicker for a kind (F10): `Specification · Forge`, etc. */
export function coverKicker(kind: ExportKind): string {
  return KICKER[kind];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render a TOC `p.N` / `p.N–M` cell, or blank when unmeasured/unresolved (F31). */
function tocCell(nn: string, ranges: TocRanges | undefined): string {
  if (!ranges) return ''; // pass 1: placeholder (blank)
  const r = ranges[nn];
  if (!r) return ''; // marker unresolved → blank cell (F31)
  return r.startPage === r.endPage ? `p.${r.startPage}` : `p.${r.startPage}–${r.endPage}`;
}

/**
 * Replace a sanitized mermaid code block with a `.mermaid` div (so an in-page
 * `mermaid.run()` renders it) when `mermaidAsDiagram` is true. The sanitized
 * HTML emits `<pre><code class="language-mermaid">SOURCE</code></pre>`.
 */
function applyMermaidMode(html: string, mermaidAsDiagram: boolean): string {
  if (!mermaidAsDiagram) return html; // leave as a code block
  return html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_m, src: string) => {
      // Decode the entities the sanitizer escaped so mermaid sees real source.
      const decoded = String(src)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x26;|&amp;/g, '&');
      return `<pre class="mermaid">${decoded}</pre>`;
    },
  );
}

/** The cover/meta-row + Contents TOC (page 1). */
function renderCover(
  kind: ExportKind,
  projectName: string,
  lede: string,
  meta: CoverMeta,
  sections: ParsedSection[],
  ranges: TocRanges | undefined,
): string {
  const tocRows = sections
    .filter((s) => s.title.length > 0)
    .map(
      (s) =>
        `<div class="toc-row"><span class="snum">${esc(s.nn)}</span><span class="toc-title">${esc(
          s.title,
        )}</span><span class="snum toc-page" data-toc="${esc(s.nn)}">${tocCell(s.nn, ranges)}</span></div>`,
    )
    .join('\n');

  return `<section class="page cover">
  <div class="kick">${esc(coverKicker(kind))}</div>
  <h1>${esc(projectName)}</h1>
  <p class="lede">${esc(lede)}</p>
  <div class="meta">
    <span><b>Owner</b>${esc(meta.owner)}</span>
    <span><b>Visibility</b>${esc(meta.visibility)}</span>
    <span><b>Components</b>${meta.componentsApproved} approved</span>
    <span><b>Audit</b><span class="audit-clean">clean ×${meta.auditClean}</span></span>
    <span><b>Version</b>${esc(meta.version)}</span>
  </div>
  <div class="toc">
    <h3 class="toc-h">Contents</h3>
    ${tocRows}
  </div>
</section>`;
}

/** One section, page-break-before, with the `<thead>`-repeat continued header. */
function renderSection(
  s: ParsedSection,
  headers: SectionHeaderMap | undefined,
  mermaidAsDiagram: boolean,
): string {
  const hdr = headers?.[s.nn];
  const chip = hdr
    ? hdr.approved
      ? `<span class="approved">✓ approved</span>`
      : `<span class="status-chip">${esc(hdr.status)}</span>`
    : '';
  const roles = hdr && hdr.roles ? `<span class="roles">${esc(hdr.roles)}</span>` : '';
  const titleText = s.title || '';
  const continuedLabel = titleText ? `${titleText} (continued)` : '(continued)';

  // Strip the leading <h2> from the body if it matches the section title
  // (the template renders its own <h2>, so the markdown-generated one would double up)
  let body = applyMermaidMode(s.html, mermaidAsDiagram);
  if (titleText) {
    body = body.replace(new RegExp(`^\\s*<h2>[^<]*</h2>\\s*`, 'i'), '');
  }

  return `<table class="section" data-section="${esc(s.nn)}">
  <thead><tr><td>
    <div class="cont">${esc(continuedLabel)}</div>
  </td></tr></thead>
  <tbody><tr><td>
    <div class="section-marker" data-section-marker="${esc(s.nn)}">§${esc(s.nn)} ${esc(titleText)}</div>
    <div class="shead"><span class="snum">${esc(s.nn)}</span>${chip}${roles}</div>
    ${titleText ? `<h2>${esc(titleText)}</h2>` : ''}
    <div class="section-body">${body}</div>
  </td></tr></tbody>
</table>`;
}

const PRINT_CSS = `
  @page { size: A4; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Spline Sans', -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #211C16; font-size: 10.5px; line-height: 1.62;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .mono, .snum, .kick, code { font-family: 'Spline Sans Mono', ui-monospace, 'SF Mono', Menlo, monospace; }
  .serif, h1, h2, .lede { font-family: 'Newsreader', Georgia, 'Times New Roman', serif; }

  .page { page-break-after: always; padding: 0; }
  .cover { display: flex; flex-direction: column; min-height: 96vh; }
  .kick { font-size: 9px; color: #C4521E; letter-spacing: .16em; text-transform: uppercase; }
  h1 { font-size: 30px; font-weight: 600; letter-spacing: -.02em; margin: 8px 0 10px; line-height: 1.1; }
  .lede { font-style: italic; font-size: 13px; color: #4A4339; line-height: 1.5; margin: 0 0 16px; }
  .meta { display: flex; gap: 14px; flex-wrap: wrap; font-size: 8.5px; color: #938979;
          padding: 11px 0; border-top: 1.5px solid #211C16; border-bottom: 1.5px solid #211C16; }
  .meta b { display: block; color: #4A4339; font-size: 7.5px; text-transform: uppercase; letter-spacing: .05em; }
  .audit-clean { color: #3A5A3C; }
  .toc { margin-top: 18px; }
  .toc-h { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #938979; margin: 0 0 6px; }
  .toc-row { display: flex; gap: 9px; font-size: 10px; padding: 5px 0; border-bottom: 1px solid #E7E0D4; color: #4A4339; }
  .toc-title { flex: 1; }
  .snum { font-size: 9px; color: #938979; }

  /* Each section starts a fresh page (F5). The first section may follow the cover. */
  table.section { width: 100%; border-collapse: collapse; page-break-before: always; }
  table.section td { padding: 0; border: 0; vertical-align: top; }
  /* Marker text MUST stay in the PDF text layer (the two-pass TOC measure reads
     it via pdf-parse) — so keep a real, non-zero font-size but render it
     invisible (transparent, 1px, no selection footprint). */
  .section-marker { font-size: 1px; line-height: 1px; color: transparent; }
  .shead { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
  .approved { font-size: 7.5px; font-weight: 600; padding: 1px 6px; border-radius: 100px; background: #E7EFE5; color: #3A5A3C; }
  .status-chip { font-size: 7.5px; font-weight: 600; padding: 1px 6px; border-radius: 100px; background: #F1ECE2; color: #938979; }
  .roles { font-size: 8px; color: #938979; }
  h2 { font-size: 18px; font-weight: 600; margin: 4px 0 10px; }
  /* The continued header (thead) only shows visible text on carry-on pages; CSS
     can't suppress it on the first page, so it stays muted + small everywhere. */
  .cont { font-size: 9px; color: #938979; font-style: italic; margin-bottom: 6px; }

  .section-body p { font-size: 10.5px; line-height: 1.62; color: #2C261F; margin: 0 0 8px; }
  .section-body h3 { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #938979; margin: 12px 0 5px; }
  .section-body ul { margin: 0 0 8px; padding-left: 16px; }
  .section-body li { font-size: 10.5px; line-height: 1.55; margin: 4px 0; }
  .section-body code { font-size: .85em; background: #F1ECE2; padding: 0 4px; border-radius: 3px; color: #9A3D14; }
  .section-body pre { background: #F1ECE2; padding: 8px; border-radius: 6px; overflow-x: auto; font-size: 9px; }
  .section-body pre.mermaid { background: #FCFAF6; border: 1px solid #D6CCBB; }
  .section-body table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 9.5px; }
  .section-body th, .section-body td { text-align: left; padding: 6px 8px; border: 1px solid #E7E0D4; }
  .section-body th { background: #F1ECE2; font-size: 8px; text-transform: uppercase; color: #4A4339; }

  /* Per-artifact divider page for the combined PDF (combined-html.ts). */
  .divider { page-break-before: always; display: flex; flex-direction: column; min-height: 96vh; }
`;

/** Puppeteer footer template (F10): `Forge · <project>` left, `n / total` right. */
export function footerTemplate(projectName: string): string {
  return `<div style="width:100%;font-family:'Spline Sans Mono',monospace;font-size:8.5px;color:#938979;padding:0 13mm;display:flex;justify-content:space-between;">
    <span>Forge · ${esc(projectName)}</span>
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;
}

/** Empty header band (footer carries the page numbers). */
export function headerTemplate(): string {
  return `<div style="font-size:0;"></div>`;
}

/** Build the complete single-artifact print HTML document. */
export function renderArtifactHtml(input: TemplateInput): string {
  const cover = renderCover(
    input.kind,
    input.projectName,
    input.lede,
    input.meta,
    input.sections,
    input.tocRanges,
  );
  const body = input.sections
    .filter((s) => s.title.length > 0)
    .map((s) => renderSection(s, input.sectionHeaders, input.mermaidAsDiagram))
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<title>${esc(input.projectName)}</title>
<style>${PRINT_CSS}</style>
</head><body>
${cover}
${body}
</body></html>`;
}
