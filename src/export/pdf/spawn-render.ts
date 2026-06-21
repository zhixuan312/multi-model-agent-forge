import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { loadExportConfig } from '@/export/config';

/**
 * Render HTML → PDF by spawning a subprocess. Bypasses Turbopack's module
 * resolution entirely — puppeteer runs in a standalone Node process.
 */
export async function spawnPdfRender(
  html: string,
  opts: { mermaidAsDiagram?: boolean } = {},
): Promise<Buffer> {
  const cfg = loadExportConfig();
  const workerPath = join(process.cwd(), 'scripts', 'pdf-worker.mjs');

  let mermaidBundlePath: string | undefined;
  if (opts.mermaidAsDiagram) {
    try {
      const req = createRequire(join(process.cwd(), 'package.json'));
      mermaidBundlePath = req.resolve('mermaid/dist/mermaid.min.js');
    } catch { /* mermaid not found — skip diagrams */ }
  }

  const input = JSON.stringify({
    html,
    mermaidBundlePath,
    mermaidAsDiagram: opts.mermaidAsDiagram ?? true,
    noSandbox: cfg.pdfNoSandbox,
    timeoutMs: cfg.pdfTimeoutMs,
  });

  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn('node', [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: cfg.pdfTimeoutMs + 5000,
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    proc.stdout!.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr!.on('data', (c: Buffer) => errChunks.push(c));

    proc.stdin!.write(input);
    proc.stdin!.end();

    proc.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const stderr = Buffer.concat(errChunks).toString().slice(0, 500);
        reject(new Error(`PDF worker exited ${code}: ${stderr}`));
      }
    });

    proc.on('error', (e) => reject(new Error(`PDF worker spawn error: ${e.message}`)));
  });
}
