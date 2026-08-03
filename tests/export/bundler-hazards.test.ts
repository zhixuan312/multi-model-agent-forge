// @vitest-environment node
/**
 * The PDF pipeline reads two files out of `node_modules` at runtime — pdfjs-dist's
 * worker (via pdf-parse) and the Mermaid UMD bundle. Both were resolved in a way the
 * Next server bundler rewrites, and both failed in the app while passing here,
 * because Vitest loads from `node_modules` and the app loads from `.next/`:
 *
 *   - pdf-parse → `Setting up fake worker failed: Cannot find module
 *     .next/…/pdf.worker.mjs`, swallowed by the measure's catch, so every exported
 *     Contents page shipped with blank page-number cells;
 *   - mermaid   → `ENOENT … mermaid.min.js [app-route] (ecmascript)` from a
 *     `require.resolve` Turbopack had rewritten into a module id. That one is thrown,
 *     not swallowed: diagrams-on is the API default, so `POST /export/bundle`
 *     returned 500 for every project on every request, and `POST /export/pdf` did
 *     too unless the caller explicitly asked for diagrams off.
 *
 * A bundler rewrite cannot be reproduced under Vitest, so these guard the SHAPE that
 * survives it. That is unusual for this suite and deliberate: the shape is the fix.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PdfRenderer, type PuppeteerLike, type PageLike, type RenderJob } from '@/export/pdf/render';
import { mermaidBundle } from '@/export/pdf/mermaid';
import { MERMAID_UMD_SPECIFIER } from '@/export/config';

describe('runtime files the server bundler must not rewrite', () => {
  it('keeps pdf-parse out of the server bundle so pdfjs can find its worker', () => {
    const cfg = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');
    const list = cfg.match(/serverExternalPackages:\s*\[([^\]]*)\]/)?.[1] ?? '';
    expect(list, 'next.config.ts must externalize pdf-parse').toContain('pdf-parse');
  });

  it('resolves the Mermaid bundle through a specifier the call site does not spell out', () => {
    const src = readFileSync(join(process.cwd(), 'src/export/pdf/mermaid.ts'), 'utf8');
    // A literal here is what Turbopack folds into a module id. The specifier has to
    // arrive from another module to stay opaque to that analysis.
    expect(src).not.toMatch(/['"]mermaid\/dist\//);
    expect(src).toContain('MERMAID_UMD_SPECIFIER');
    // …and anchored at the app root, not at a chunk under .next/.
    expect(src).not.toContain('createRequire(import.meta.url)');
  });

  it('the specifier names a file that is actually installed', () => {
    const require = createRequireForRoot();
    const path = require.resolve(MERMAID_UMD_SPECIFIER);
    expect(existsSync(path)).toBe(true);
    expect(mermaidBundle().length).toBeGreaterThan(1000);
  });
});

function createRequireForRoot(): NodeJS.Require {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- node:module in a node-env test
  const { createRequire } = require('node:module') as typeof import('node:module');
  return createRequire(join(process.cwd(), 'package.json'));
}

/* ── the measure must degrade visibly, not silently ─────────────────────── */

function fakePage(): PageLike {
  return {
    setRequestInterception: async () => {},
    on: () => {},
    setContent: async () => {},
    addScriptTag: async () => {},
    evaluate: async () => 0,
    pdf: async () => Buffer.from('%PDF-fake'),
    close: async () => {},
  };
}

const fakePuppeteer: PuppeteerLike = {
  async launch() {
    return { newPage: async () => fakePage(), close: async () => {}, connected: true };
  },
};

const JOB: RenderJob = {
  sourceBytes: 10,
  projectName: 'P',
  sectionKeys: ['01'],
  mermaidAsDiagram: false,
  buildHtml: () => '<html><body>x</body></html>',
};

describe('two-pass TOC measure', () => {
  it('still returns a PDF when the measure fails, but says so', async () => {
    const logs: { event: string }[] = [];
    const r = new PdfRenderer({
      puppeteer: fakePuppeteer,
      pdfPageTexts: async () => {
        throw new Error('pdfjs worker missing');
      },
      log: (e) => logs.push(e as { event: string }),
    });

    // Blank Contents cells beat a failed download — the export must survive.
    await expect(r.render(JOB)).resolves.toBeInstanceOf(Buffer);
    // But it must not be invisible. This catch was bare, and the measure threw on
    // every request in the app for as long as it shipped with nobody the wiser.
    expect(
      logs.map((l) => l.event),
      'a failed measure must be logged, not swallowed',
    ).toContain('pdf_toc_measure_failed');
    await r.close();
  });

  it('logs nothing of the sort when the measure succeeds', async () => {
    const logs: { event: string }[] = [];
    const r = new PdfRenderer({
      puppeteer: fakePuppeteer,
      pdfPageTexts: async () => ['§01 first page'],
      log: (e) => logs.push(e as { event: string }),
    });
    await r.render(JOB);
    expect(logs.map((l) => l.event)).not.toContain('pdf_toc_measure_failed');
    await r.close();
  });
});
