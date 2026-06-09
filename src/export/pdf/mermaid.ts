/**
 * Stage-3 of the PDF pipeline (Spec 8 §"Server-side Mermaid render", F22/F29).
 *
 * `runMermaid(page, opts)` operates on the LIVE print page handle that
 * `pdf/render.ts` owns — it never launches Chromium. Sequence inside
 * `PdfRenderer.render()`: `setContent(html)` → `await runMermaid(page, opts)` →
 * `page.pdf()`. When `mermaidAsDiagram` is false it is a no-op (the fences were
 * already emitted as code blocks by the template).
 *
 * The Mermaid bundle is read from local `node_modules` (`mermaid/dist/mermaid.min.js`)
 * and injected via `page.addScriptTag({ content })` — NEVER a CDN (no egress;
 * the print page's request interception would abort a CDN fetch anyway, F22).
 *
 * Per-block error handling (F-mermaid-parse): one bad diagram does not fail the
 * PDF — each `.mermaid` node renders independently so a parse failure falls back
 * to the source + a muted note while the other diagrams + PDF succeed.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export interface RunMermaidOptions {
  mermaidAsDiagram: boolean;
}

/** Minimal structural type for the puppeteer Page methods we use (test-injectable). */
export interface MermaidPage {
  addScriptTag(opts: { content: string }): Promise<unknown>;
  evaluate(fn: (...args: never[]) => unknown, ...args: unknown[]): Promise<number>;
}

let _bundle: string | null = null;

/** Read + cache the local mermaid UMD bundle (no egress). */
export function mermaidBundle(): string {
  if (_bundle != null) return _bundle;
  const require = createRequire(import.meta.url);
  const path = require.resolve('mermaid/dist/mermaid.min.js');
  _bundle = readFileSync(path, 'utf-8');
  return _bundle;
}

/**
 * Inject the bundled Mermaid runtime into the live page and render every
 * `pre.mermaid` node, per-block error-tolerant. No-op when `mermaidAsDiagram`
 * is false. Returns the count of blocks rendered (observability/tests).
 */
export async function runMermaid(page: MermaidPage, opts: RunMermaidOptions): Promise<number> {
  if (!opts.mermaidAsDiagram) return 0;

  await page.addScriptTag({ content: mermaidBundle() });

  return await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const mermaid = w.mermaid;
    if (!mermaid) return 0;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const nodes = Array.from(document.querySelectorAll('pre.mermaid')) as HTMLElement[];
    let rendered = 0;
    let i = 0;
    for (const node of nodes) {
      const source = node.textContent ?? '';
      const id = `mmd-${i++}`;
      try {
        const out = await mermaid.render(id, source);
        const svg = (out && (out as { svg?: string }).svg) || '';
        if (!svg) throw new Error('empty-svg');
        const wrap = document.createElement('div');
        wrap.className = 'mermaid-svg';
        wrap.innerHTML = svg;
        node.replaceWith(wrap);
        rendered++;
      } catch {
        const note = document.createElement('div');
        note.className = 'mermaid-fallback';
        note.setAttribute('data-mermaid-error', '1');
        const pre = document.createElement('pre');
        pre.textContent = source;
        const msg = document.createElement('div');
        msg.style.cssText = 'font-size:8px;color:#938979;font-style:italic';
        msg.textContent = 'diagram could not be rendered';
        note.appendChild(pre);
        note.appendChild(msg);
        node.replaceWith(note);
      }
    }
    return rendered;
  });
}
