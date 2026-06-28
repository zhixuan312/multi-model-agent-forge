/**
 * Combined-PDF assembler (Spec 8 §"Combined PDF (for the bundle)", F9/F20/F28/F32).
 *
 * Orchestrates the multi-artifact document: iterate ready artifacts in the fixed
 * authoring order exploration→spec→plan→review (F20), insert a per-artifact
 * divider/cover page before each, concatenate their section HTML into ONE
 * continuous HTML doc, and hand a single `RenderJob` to `PdfRenderer` so
 * pagination + footers are continuous across artifact boundaries.
 *
 * A present-but-malformed spec (zero `## NN.`) aborts the whole bundle with
 * `SpecHeadingContractError` (F32) — surfaced by the route as 409.
 */
import {
  parseArtifactSections,
  type ParsedSection,
} from '@/export/sections';
import {
  renderArtifactHtml,
  coverKicker,
  footerTemplate,
  headerTemplate,
  PDF_MARGINS,
} from '@/export/pdf/template';
import type { CollectedArtifact } from '@/export/collect-artifacts';
import type { RenderJob, PageLike, BrowserLike } from '@/export/pdf/render';
import type { TocRanges, ExportKind } from '@/export/types';

const ORDER: ExportKind[] = ['exploration', 'spec', 'plan', 'journal'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Parse one collected artifact into its page-able sections (spec fail-loud). */
function sectionsFor(a: CollectedArtifact): ParsedSection[] {
  return parseArtifactSections(a.bodyMd, a.kind);
}

/** A per-artifact divider page (kicker + title) for the combined doc. */
function dividerPage(a: CollectedArtifact, projectName: string): string {
  return `<section class="divider">
  <div class="kick">${esc(coverKicker(a.kind))}</div>
  <h1>${esc(projectName)}</h1>
  <p class="lede">${esc(a.kind === 'spec' ? 'Specification' : a.kind === 'plan' ? 'Plan' : a.kind === 'journal' ? 'Journal' : 'Exploration')}</p>
</section>`;
}

/** Build the single combined HTML doc body (dividers + concatenated sections). */
export function renderCombinedHtml(
  artifacts: CollectedArtifact[],
  projectName: string,
  mermaidAsDiagram: boolean,
  tocRanges: TocRanges | undefined,
): string {
  // We reuse renderArtifactHtml per artifact for its section markup, but strip
  // the per-artifact <html>/<head> wrapper so the result is one document. To
  // keep it simple + robust, render each artifact's INNER body via a small
  // extraction, prefixed by a divider page.
  const ordered = [...artifacts].sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));

  const parts: string[] = [];
  for (const a of ordered) {
    const sections = sectionsFor(a);
    parts.push(dividerPage(a, projectName));
    const single = renderArtifactHtml({
      kind: a.kind,
      projectName,
      lede: '',
      meta: a.meta,
      sections,
      sectionHeaders: a.sectionHeaders,
      tocRanges,
      mermaidAsDiagram,
    });
    // Extract just the section tables (drop the per-artifact cover so the
    // combined doc has ONE leading cover via the first divider; the spec-cover
    // TOC of a single artifact is not reused for the combined doc).
    const bodyInner = single.slice(single.indexOf('</section>') + '</section>'.length, single.indexOf('</body>'));
    // Skip the first artifact's own cover/contents (it lives before the first
    // section table). Keep everything from the first section table onward.
    const firstTable = bodyInner.indexOf('<table class="section"');
    parts.push(firstTable >= 0 ? bodyInner.slice(firstTable) : bodyInner);
  }

  const COMBINED_CSS = extractTemplateCss();
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>${esc(projectName)}</title>
<style>${COMBINED_CSS}</style></head><body>
${parts.join('\n')}
</body></html>`;
}

/** Pull the print CSS from the single-artifact template (one source of truth). */
function extractTemplateCss(): string {
  // Render a throwaway minimal doc and slice its <style> so the combined doc
  // shares identical print CSS without duplicating the literal.
  const probe = renderArtifactHtml({
    kind: 'spec',
    projectName: 'x',
    lede: '',
    meta: { owner: '', visibility: '', componentsApproved: 0, auditClean: 0, version: '' },
    sections: [],
    mermaidAsDiagram: false,
  });
  const start = probe.indexOf('<style>') + '<style>'.length;
  const end = probe.indexOf('</style>');
  return probe.slice(start, end);
}

/** All section `NN` keys across the combined artifacts (for the measure). */
function combinedSectionKeys(artifacts: CollectedArtifact[]): string[] {
  const keys: string[] = [];
  for (const a of [...artifacts].sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind))) {
    for (const s of sectionsFor(a)) keys.push(s.nn);
  }
  return keys;
}

/**
 * Build a `RenderJob` for the combined PDF. Throws `SpecHeadingContractError`
 * eagerly if a present spec is malformed (F32) — callers map to 409.
 */
export function buildCombinedJob(
  artifacts: CollectedArtifact[],
  projectName: string,
  mermaidAsDiagram: boolean,
): RenderJob {
  // Validate the spec heading contract up front (parse throws on zero ## NN.).
  for (const a of artifacts) sectionsFor(a);

  const sourceBytes = artifacts.reduce((n, a) => n + Buffer.byteLength(a.bodyMd), 0);
  return {
    sourceBytes,
    projectName,
    sectionKeys: combinedSectionKeys(artifacts),
    mermaidAsDiagram,
    buildHtml: (tocRanges) => renderCombinedHtml(artifacts, projectName, mermaidAsDiagram, tocRanges),
  };
}

// Re-export structural page types so the @pdf test imports stay in one place.
export type { PageLike, BrowserLike };
export { footerTemplate, headerTemplate, PDF_MARGINS };
