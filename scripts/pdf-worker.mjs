#!/usr/bin/env node
/**
 * PDF subprocess worker — runs OUTSIDE Turbopack.
 * stdin: JSON { html, mermaidBundlePath?, mermaidAsDiagram, noSandbox?, timeoutMs? }
 * stdout: raw PDF bytes
 */
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';

const input = await new Promise((resolve) => {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
});

const { html, mermaidBundlePath, mermaidAsDiagram, noSandbox, timeoutMs = 30000 } = input;

const args = ['--disable-dev-shm-usage'];
if (noSandbox !== false) args.push('--no-sandbox');

const browser = await puppeteer.launch({ headless: true, args });
try {
  const page = await browser.newPage();

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('about:') || url === '') req.continue();
    else req.abort();
  });

  await page.setContent(html, { waitUntil: 'networkidle0', timeout: timeoutMs });

  if (mermaidAsDiagram && mermaidBundlePath) {
    const bundle = readFileSync(mermaidBundlePath, 'utf-8');
    await page.addScriptTag({ content: bundle });
    await page.evaluate(async () => {
      const nodes = document.querySelectorAll('pre.mermaid');
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        try {
          const { svg } = await window.mermaid.render(`m${i}`, el.textContent);
          el.outerHTML = svg;
        } catch {
          const src = el.textContent;
          el.innerHTML = `<p style="color:#999;font-size:12px">[diagram render error]</p><pre style="font-size:11px;color:#666">${src}</pre>`;
        }
      }
    });
  }

  // Light CSS fixes for content tables and diagrams (template handles page layout)
  await page.addStyleTag({ content: `
    table.content-table { font-size: 10pt; width: 100%; border-collapse: collapse; }
    table.content-table th, table.content-table td { border: 1px solid #ddd; padding: 6px 8px; }
    table.content-table th { background: #f5f5f0; font-weight: 600; }
    pre { white-space: pre-wrap; word-break: break-word; }
    svg { max-width: 100%; height: auto; }
  `});

  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
    timeout: timeoutMs,
  });

  process.stdout.write(Buffer.from(pdf));
} finally {
  await browser.close();
}
