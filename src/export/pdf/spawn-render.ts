import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { loadExportConfig } from '@/export/config';
import { safeChildEnv } from '@/build/command-runner';

/**
 * Render HTML → PDF by spawning a subprocess. Bypasses Turbopack's module
 * resolution entirely — puppeteer runs in a standalone Node process.
 */
export async function spawnPdfRender(
  html: string,
  opts: { mermaidAsDiagram?: boolean } = {},
): Promise<Buffer> {
  const cfg = loadExportConfig();
  // The worker path comes from the runtime config object (resolved in
  // export/config.ts), never a literal join here. Turbopack statically analyzes
  // `child_process.spawn` arguments; a path built from literal segments at this
  // call site (`join(cwd, 'scripts', 'pdf-worker.mjs')`) is mistaken for a
  // bundled module and fails the build — this is a standalone Node script
  // spawned as a subprocess, never imported. A cross-module runtime value is
  // opaque to that analysis, so the bundler leaves it alone.
  const workerPath = cfg.pdfWorkerPath;

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
    launchTimeoutMs: cfg.pdfLaunchTimeoutMs,
  });

  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn('node', [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Scrubbed: this subprocess launches Chromium over HTML derived from user content,
      // and it reads NO environment of its own — every setting arrives on stdin. There is
      // no reason for FORGE_SECRET_KEY or DATABASE_URL to be in a browser's environment.
      // PATH and HOME survive, which is what Chromium needs for its profile and cache.
      env: safeChildEnv() as NodeJS.ProcessEnv,
      // The subprocess pays a Chromium cold start BEFORE it renders, so its wall
      // clock must cover launch + render, not render alone.
      timeout: cfg.pdfLaunchTimeoutMs + cfg.pdfTimeoutMs + 5000,
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
