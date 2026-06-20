/**
 * Stage-4/5 of the PDF pipeline (Spec 8 §"Puppeteer headless Chrome print",
 * F11/F14/F15/F18). A single `PdfRenderer` owns ONE lazily-launched, reused,
 * health-checked Chromium and a SERIAL job queue (concurrency 1).
 *
 * Reliability surface (all testable):
 *  - single launch — N requests call `puppeteer.launch` at most once;
 *  - serialized — jobs run one at a time;
 *  - relaunch-after-death — a dead browser triggers exactly one relaunch;
 *  - per-render timeout `FORGE_PDF_TIMEOUT_MS` → PdfTimeoutError (504);
 *  - input cap `FORGE_PDF_MAX_SOURCE_BYTES` → PdfTooLargeError (413) BEFORE launch;
 *  - bounded queue `FORGE_PDF_MAX_QUEUE` → PdfQueueFullError (503);
 *  - network-deny in the print page (request interception aborts non-bundled);
 *  - two-pass TOC measure (pass 1 → pdf-parse boundaries → pass 2 final);
 *  - per-job structured render log + boot probe().
 *
 * The puppeteer module is injected (default: the real `puppeteer`) so the
 * concurrency/timeout/queue behavior is unit-testable with a mock launcher.
 */
import { runMermaid } from '@/export/pdf/mermaid';
import {
  renderArtifactHtml,
  footerTemplate,
  headerTemplate,
  PDF_MARGINS,
} from '@/export/pdf/template';
import type { TemplateInput, TocRanges } from '@/export/types';
import { loadExportConfig, type ExportConfig } from '@/export/config';

/* ── Typed errors (route maps to status codes) ──────────────────────────── */

export class PdfTimeoutError extends Error {
  constructor() {
    super('pdf_render_timeout');
    this.name = 'PdfTimeoutError';
  }
}
export class PdfTooLargeError extends Error {
  constructor() {
    super('export_too_large');
    this.name = 'PdfTooLargeError';
  }
}
export class PdfQueueFullError extends Error {
  constructor() {
    super('pdf_queue_full');
    this.name = 'PdfQueueFullError';
  }
}
export class PdfEngineError extends Error {
  constructor(cause?: unknown) {
    super('pdf_engine_unavailable');
    this.name = 'PdfEngineError';
    if (cause instanceof Error) this.stack += `\nCaused by: ${cause.stack}`;
  }
}

/* ── Injected puppeteer surface (structural) ────────────────────────────── */

export interface PageLike {
  setRequestInterception(on: boolean): Promise<void>;
  on(event: 'request', handler: (req: RequestLike) => void): void;
  setContent(html: string, opts?: { waitUntil?: string; timeout?: number }): Promise<void>;
  addScriptTag(opts: { content: string }): Promise<unknown>;
  evaluate(fn: (...a: never[]) => unknown, ...args: unknown[]): Promise<number>;
  pdf(opts: Record<string, unknown>): Promise<Uint8Array | Buffer>;
  close(): Promise<void>;
}
export interface RequestLike {
  url(): string;
  abort(): Promise<void> | void;
  continue(): Promise<void> | void;
}
export interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
  connected?: boolean;
  process?(): unknown;
}
export interface PuppeteerLike {
  launch(opts: Record<string, unknown>): Promise<BrowserLike>;
}

/* ── pdf-parse injection (page-boundary readback for the TOC measure) ────── */

export type PdfPageTexts = (buf: Buffer) => Promise<string[]>;

/** Default pdf-parse adapter: returns per-page text for the two-pass measure. */
export async function defaultPdfPageTexts(buf: Buffer): Promise<string[]> {
  // pdf-parse v2 exposes a `PDFParse` class whose `getText()` returns
  // `{ pages: [{ text, num }], text, total }`.
  const mod = (await import('pdf-parse')) as unknown as {
    PDFParse: new (opts: { data: Buffer }) => {
      getText(): Promise<{ pages: { text: string; num: number }[]; text: string }>;
      destroy?: () => Promise<void> | void;
    };
  };
  const parser = new mod.PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return (result.pages ?? []).map((p) => p.text ?? '');
  } finally {
    await parser.destroy?.();
  }
}

/* ── Structured render log (F15) ────────────────────────────────────────── */

export interface RenderLog {
  event: 'pdf_render';
  outcome: 'ok' | 'timeout' | 'engine_error';
  durationMs: number;
  sourceBytes: number;
  passes: number;
  queueDepthAtEnqueue: number;
}

export interface PdfRendererDeps {
  puppeteer?: PuppeteerLike;
  config?: ExportConfig;
  pdfPageTexts?: PdfPageTexts;
  log?: (entry: RenderLog | { event: string; [k: string]: unknown }) => void;
  now?: () => number;
}

/** A render job: combined HTML builder + the project name for the footer. */
export interface RenderJob {
  /** The source markdown byte length (for the size cap). */
  sourceBytes: number;
  /** The project name for the footer + the TOC section keys present in the HTML. */
  projectName: string;
  /** Section `NN` keys whose page ranges the two-pass should measure. */
  sectionKeys: string[];
  /**
   * Build the print HTML. `tocRanges` is undefined on pass 1 (placeholder) and
   * the measured map on pass 2. `mermaidAsDiagram` drives `runMermaid`.
   */
  buildHtml: (tocRanges: TocRanges | undefined) => string;
  mermaidAsDiagram: boolean;
}

interface QueueEntry {
  job: RenderJob;
  resolve: (buf: Buffer) => void;
  reject: (err: unknown) => void;
  enqueuedAt: number;
  queueDepthAtEnqueue: number;
}

export class PdfRenderer {
  private readonly puppeteer: PuppeteerLike;
  private readonly cfg: ExportConfig;
  private readonly pdfPageTexts: PdfPageTexts;
  private readonly logFn: (e: { event: string; [k: string]: unknown }) => void;
  private readonly now: () => number;

  private browser: BrowserLike | null = null;
  private launching: Promise<BrowserLike> | null = null;
  private queue: QueueEntry[] = [];
  private running = false;

  constructor(deps: PdfRendererDeps = {}) {
    this.cfg = deps.config ?? loadExportConfig();
    this.puppeteer = deps.puppeteer ?? lazyRealPuppeteer();
    this.pdfPageTexts = deps.pdfPageTexts ?? defaultPdfPageTexts;
    this.logFn = deps.log ?? ((e) => console.log(JSON.stringify(e)));
    this.now = deps.now ?? Date.now;
  }

  /** Launch args (F12): --no-sandbox/--disable-dev-shm-usage gated by config. */
  private launchOpts(): Record<string, unknown> {
    const args: string[] = [];
    if (this.cfg.pdfNoSandbox) args.push('--no-sandbox', '--disable-dev-shm-usage');
    const opts: Record<string, unknown> = { headless: true, args };
    if (this.cfg.puppeteerExecutablePath) opts.executablePath = this.cfg.puppeteerExecutablePath;
    return opts;
  }

  /** Whether the reused browser is alive. */
  private alive(b: BrowserLike | null): b is BrowserLike {
    if (!b) return false;
    if (typeof b.connected === 'boolean') return b.connected;
    return true;
  }

  /** Get (or lazily launch / relaunch) the single browser. */
  private async getBrowser(): Promise<BrowserLike> {
    if (this.alive(this.browser)) return this.browser;
    if (this.launching) return this.launching;
    this.launching = (async () => {
      try {
        const b = await this.puppeteer.launch(this.launchOpts());
        this.browser = b;
        return b;
      } catch (e) {
        this.logFn({ event: 'pdf_engine_unavailable', error: String(e) });
        throw e;
      } finally {
        this.launching = null;
      }
    })();
    return this.launching;
  }

  /** Boot health probe (#10) — launch + close once. Non-fatal at the caller. */
  async probe(): Promise<boolean> {
    try {
      const b = await this.puppeteer.launch(this.launchOpts());
      await b.close();
      return true;
    } catch (e) {
      this.logFn({ event: 'pdf_engine_unavailable', error: String(e) });
      return false;
    }
  }

  /** Enqueue a render. Rejects fast with PdfQueueFullError beyond the cap. */
  render(job: RenderJob): Promise<Buffer> {
    if (job.sourceBytes > this.cfg.pdfMaxSourceBytes) {
      return Promise.reject(new PdfTooLargeError());
    }
    // in-flight (running) + queued depth.
    const depth = this.queue.length + (this.running ? 1 : 0);
    if (depth >= this.cfg.pdfMaxQueue) {
      return Promise.reject(new PdfQueueFullError());
    }
    return new Promise<Buffer>((resolve, reject) => {
      this.queue.push({
        job,
        resolve,
        reject,
        enqueuedAt: this.now(),
        queueDepthAtEnqueue: depth,
      });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const entry = this.queue.shift()!;
        // Drop a job that waited past the timeout without starting (503).
        if (this.now() - entry.enqueuedAt > this.cfg.pdfTimeoutMs) {
          entry.reject(new PdfQueueFullError());
          continue;
        }
        await this.runOne(entry);
      }
    } finally {
      this.running = false;
    }
  }

  private async runOne(entry: QueueEntry): Promise<void> {
    const start = this.now();
    try {
      const buf = await this.withTimeout(() => this.renderJob(entry.job), this.cfg.pdfTimeoutMs);
      this.logFn({
        event: 'pdf_render',
        outcome: 'ok',
        durationMs: this.now() - start,
        sourceBytes: entry.job.sourceBytes,
        passes: 2,
        queueDepthAtEnqueue: entry.queueDepthAtEnqueue,
      });
      entry.resolve(buf);
    } catch (e) {
      const outcome = e instanceof PdfTimeoutError ? 'timeout' : 'engine_error';
      this.logFn({
        event: 'pdf_render',
        outcome,
        error: String(e),
        durationMs: this.now() - start,
        sourceBytes: entry.job.sourceBytes,
        passes: 2,
        queueDepthAtEnqueue: entry.queueDepthAtEnqueue,
      });
      entry.reject(e);
    }
  }

  private withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const t = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new PdfTimeoutError());
      }, ms);
      fn().then(
        (v) => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          reject(e instanceof PdfTimeoutError ? e : new PdfEngineError(e));
        },
      );
    });
  }

  /** One job = a deterministic two-pass render (measure → inject → final). */
  private async renderJob(job: RenderJob): Promise<Buffer> {
    const browser = await this.getBrowser();

    // Pass 1 (measure): placeholder TOC.
    const buf1 = await this.printOnce(browser, job.buildHtml(undefined), job.projectName, job.mermaidAsDiagram);
    let ranges: TocRanges | undefined;
    try {
      ranges = await this.measureRanges(buf1, job.sectionKeys);
    } catch {
      ranges = undefined; // measure failed → blank cells (graceful, F31)
    }

    // Pass 2 (final): measured TOC ranges.
    const buf2 = await this.printOnce(browser, job.buildHtml(ranges), job.projectName, job.mermaidAsDiagram);
    return buf2;
  }

  /** Single setContent → network-deny → mermaid → page.pdf print. */
  private async printOnce(
    browser: BrowserLike,
    html: string,
    projectName: string,
    mermaidAsDiagram: boolean,
  ): Promise<Buffer> {
    const page = await browser.newPage();
    try {
      // Network-deny (F13): abort every request that is not the document/data.
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        const allowed = url.startsWith('data:') || url.startsWith('about:') || url === '';
        if (allowed) void req.continue();
        else void req.abort();
      });

      await page.setContent(html, { waitUntil: 'networkidle0', timeout: this.cfg.pdfTimeoutMs });
      await runMermaid(page, { mermaidAsDiagram });
      const out = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: headerTemplate(),
        footerTemplate: footerTemplate(projectName),
        margin: { ...PDF_MARGINS },
        timeout: this.cfg.pdfTimeoutMs,
      });
      return Buffer.isBuffer(out) ? out : Buffer.from(out);
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** Recover NN → {startPage,endPage} from the pass-1 PDF text-per-page (F1). */
  private async measureRanges(buf: Buffer, sectionKeys: string[]): Promise<TocRanges> {
    const pages = await this.pdfPageTexts(buf);
    const ranges: TocRanges = {};
    for (const nn of sectionKeys) {
      const marker = `§${nn}`;
      let start = -1;
      let end = -1;
      pages.forEach((text, idx) => {
        if (text.includes(marker)) {
          const pageNo = idx + 1;
          if (start === -1) start = pageNo;
          end = pageNo;
        }
      });
      if (start !== -1) ranges[nn] = { startPage: start, endPage: end };
      // unresolved markers are simply absent → blank cell (F31)
    }
    return ranges;
  }

  /** Close the browser (for shutdown / tests). */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

/* ── Real puppeteer (lazy import so unit tests never pull Chromium) ──────── */

function lazyRealPuppeteer(): PuppeteerLike {
  return {
    async launch(opts) {
      // Puppeteer is ESM-only — Turbopack can't externalize it via require().
      // Use createRequire to load from a CJS context which Node resolves correctly.
      const mod = (await import('puppeteer')) as unknown as { default: PuppeteerLike };
      const pptr = mod.default ?? (mod as unknown as PuppeteerLike);
      return pptr.launch(opts);
    },
  };
}

/* ── Convenience: build a single-artifact RenderJob from a TemplateInput ─── */

export function artifactRenderJob(input: TemplateInput, sourceBytes: number): RenderJob {
  return {
    sourceBytes,
    projectName: input.projectName,
    sectionKeys: input.sections.map((s) => s.nn),
    mermaidAsDiagram: input.mermaidAsDiagram,
    buildHtml: (tocRanges) => renderArtifactHtml({ ...input, tocRanges }),
  };
}

/* ── Process-wide singleton (lazily created) ────────────────────────────── */

let _singleton: PdfRenderer | null = null;
export function getPdfRenderer(): PdfRenderer {
  if (!_singleton) _singleton = new PdfRenderer();
  return _singleton;
}
