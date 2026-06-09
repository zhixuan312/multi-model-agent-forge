// @vitest-environment node
import { vi } from 'vitest';
import {
  PdfRenderer,
  PdfTimeoutError,
  PdfTooLargeError,
  PdfQueueFullError,
  type PuppeteerLike,
  type BrowserLike,
  type PageLike,
  type RenderJob,
} from '@/export/pdf/render';
import { loadExportConfig } from '@/export/config';

/* A controllable fake page/browser/puppeteer. */
function makeFakePage(opts: { pdfDelayMs?: number; neverSettle?: boolean } = {}): PageLike {
  return {
    setRequestInterception: async () => {},
    on: () => {},
    setContent: async () => {
      if (opts.neverSettle) await new Promise(() => {}); // hang forever
    },
    addScriptTag: async () => {},
    evaluate: async () => 0,
    pdf: async () => {
      if (opts.pdfDelayMs) await new Promise((r) => setTimeout(r, opts.pdfDelayMs));
      return Buffer.from('%PDF-fake');
    },
    close: async () => {},
  };
}

function makeFakePuppeteer(over: {
  page?: () => PageLike;
  onLaunch?: () => void;
  connectedAfterLaunch?: boolean[];
} = {}): { puppeteer: PuppeteerLike; launchCount: () => number } {
  let launches = 0;
  const connectedSeq = over.connectedAfterLaunch ?? [];
  const puppeteer: PuppeteerLike = {
    async launch() {
      over.onLaunch?.();
      const idx = launches;
      launches++;
      const browser: BrowserLike = {
        newPage: async () => (over.page ? over.page() : makeFakePage()),
        close: async () => {},
        connected: connectedSeq.length > idx ? connectedSeq[idx] : true,
      };
      return browser;
    },
  };
  return { puppeteer, launchCount: () => launches };
}

function job(over: Partial<RenderJob> = {}): RenderJob {
  return {
    sourceBytes: 100,
    projectName: 'P',
    sectionKeys: ['01'],
    mermaidAsDiagram: false,
    buildHtml: () => '<html><body>x</body></html>',
    ...over,
  };
}

const NO_MEASURE = async () => ['§01 first page'];

describe('PdfRenderer — single launch + serialized (F11)', () => {
  it('N concurrent renders launch Chromium at most once', async () => {
    const { puppeteer, launchCount } = makeFakePuppeteer();
    const r = new PdfRenderer({ puppeteer, pdfPageTexts: NO_MEASURE });
    await Promise.all([r.render(job()), r.render(job()), r.render(job()), r.render(job())]);
    expect(launchCount()).toBe(1);
    await r.close();
  });

  it('jobs run one at a time (serialized)', async () => {
    let active = 0;
    let maxActive = 0;
    const page = (): PageLike => ({
      ...makeFakePage(),
      pdf: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((res) => setTimeout(res, 10));
        active--;
        return Buffer.from('%PDF-fake');
      },
    });
    const { puppeteer } = makeFakePuppeteer({ page });
    const r = new PdfRenderer({ puppeteer, pdfPageTexts: NO_MEASURE });
    await Promise.all([r.render(job()), r.render(job()), r.render(job())]);
    expect(maxActive).toBe(1); // concurrency 1
    await r.close();
  });

  it('relaunches exactly once when the reused browser is dead at job start', async () => {
    // First launch reports connected=false (dead), forcing a relaunch.
    const { puppeteer, launchCount } = makeFakePuppeteer({ connectedAfterLaunch: [false, true] });
    const r = new PdfRenderer({ puppeteer, pdfPageTexts: NO_MEASURE });
    await r.render(job());
    await r.render(job());
    // launch #1 dead → next getBrowser relaunches → 2 total, then stays alive.
    expect(launchCount()).toBe(2);
    await r.close();
  });
});

describe('PdfRenderer — caps (F14/F15)', () => {
  it('source over FORGE_PDF_MAX_SOURCE_BYTES → PdfTooLargeError, no launch', async () => {
    const { puppeteer, launchCount } = makeFakePuppeteer();
    const cfg = loadExportConfig({ FORGE_PDF_MAX_SOURCE_BYTES: '50' });
    const r = new PdfRenderer({ puppeteer, config: cfg, pdfPageTexts: NO_MEASURE });
    await expect(r.render(job({ sourceBytes: 999 }))).rejects.toBeInstanceOf(PdfTooLargeError);
    expect(launchCount()).toBe(0);
    await r.close();
  });

  it('a never-settling render aborts at the timeout (504) and a subsequent job still runs', async () => {
    const cfg = loadExportConfig({ FORGE_PDF_TIMEOUT_MS: '40' });
    let call = 0;
    const page = (): PageLike => {
      call++;
      return call === 1 ? makeFakePage({ neverSettle: true }) : makeFakePage();
    };
    const { puppeteer } = makeFakePuppeteer({ page });
    const r = new PdfRenderer({ puppeteer, config: cfg, pdfPageTexts: NO_MEASURE });
    // The first render hangs and must abort at the timeout.
    await expect(r.render(job())).rejects.toBeInstanceOf(PdfTimeoutError);
    // A job enqueued AFTER the hung one drained must still render — the queue
    // was freed by the timeout, not stalled.
    await expect(r.render(job())).resolves.toBeInstanceOf(Buffer);
    await r.close();
  });

  it('enqueuing beyond FORGE_PDF_MAX_QUEUE → PdfQueueFullError while the in-flight job completes', async () => {
    const cfg = loadExportConfig({ FORGE_PDF_MAX_QUEUE: '2', FORGE_PDF_TIMEOUT_MS: '5000' });
    // Hold the in-flight job so the queue fills.
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    let first = true;
    const page = (): PageLike => {
      const isFirst = first;
      first = false;
      return {
        ...makeFakePage(),
        pdf: async () => {
          if (isFirst) await gate;
          return Buffer.from('%PDF-fake');
        },
      };
    };
    const { puppeteer } = makeFakePuppeteer({ page });
    const r = new PdfRenderer({ puppeteer, config: cfg, pdfPageTexts: NO_MEASURE });

    const p1 = r.render(job()); // becomes in-flight (depth 1)
    await new Promise((res) => setTimeout(res, 5)); // let p1 start
    const p2 = r.render(job()); // queued (depth now 2 incl. running)
    // depth is now 2 (1 running + 1 queued) == MAX_QUEUE → next rejects
    await expect(r.render(job())).rejects.toBeInstanceOf(PdfQueueFullError);

    release();
    await expect(p1).resolves.toBeInstanceOf(Buffer);
    await expect(p2).resolves.toBeInstanceOf(Buffer);
    await r.close();
  });
});

describe('PdfRenderer — probe + logging', () => {
  it('probe() returns true on a healthy launch', async () => {
    const { puppeteer } = makeFakePuppeteer();
    const r = new PdfRenderer({ puppeteer, pdfPageTexts: NO_MEASURE });
    expect(await r.probe()).toBe(true);
  });

  it('probe() returns false + logs pdf_engine_unavailable on a broken launch (non-fatal)', async () => {
    const puppeteer: PuppeteerLike = {
      async launch() {
        throw new Error('no chromium');
      },
    };
    const logs: { event: string }[] = [];
    const r = new PdfRenderer({ puppeteer, pdfPageTexts: NO_MEASURE, log: (e) => logs.push(e as { event: string }) });
    expect(await r.probe()).toBe(false);
    expect(logs.some((l) => l.event === 'pdf_engine_unavailable')).toBe(true);
  });

  it('emits a structured pdf_render log per successful job', async () => {
    const { puppeteer } = makeFakePuppeteer();
    const logs: { event: string; outcome?: string }[] = [];
    const r = new PdfRenderer({ puppeteer, pdfPageTexts: NO_MEASURE, log: (e) => logs.push(e as never) });
    await r.render(job());
    const renderLog = logs.find((l) => l.event === 'pdf_render');
    expect(renderLog?.outcome).toBe('ok');
    await r.close();
  });
});
