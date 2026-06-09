/**
 * Export-service env config (Spec 8 §Modules `config.ts`, F33). Zod-validated,
 * parsed once and consumed by `pdf/render.ts`, `record.ts`, `export-root.ts`,
 * `startup.ts`. Numeric vars are positive integers (project Zod-config rule).
 *
 *  FORGE_EXPORT_ROOT          string,  default <cwd>/.forge-exports
 *  FORGE_PDF_TIMEOUT_MS       int>0,   default 30000  (504 on expiry)
 *  FORGE_PDF_MAX_SOURCE_BYTES int>0,   default 5_242_880 (413 over)
 *  FORGE_PDF_MAX_QUEUE        int>0,   default 8      (503 over)
 *  PUPPETEER_EXECUTABLE_PATH  optional string
 *  FORGE_PDF_NO_SANDBOX       bool,    default true   (gates --no-sandbox flags)
 *
 * NOTE on the default root: the spec's canonical default is
 * `/workspace/.forge-exports` (the co-located deploy). On a dev box there is no
 * `/workspace`, so the default resolves to `<cwd>/.forge-exports` (gitignored).
 * Set FORGE_EXPORT_ROOT explicitly in the deploy.
 */
import { z } from 'zod';
import { isAbsolute, resolve, join } from 'node:path';

const boolEnv = z
  .union([z.boolean(), z.string()])
  .transform((v) => {
    if (typeof v === 'boolean') return v;
    const s = v.trim().toLowerCase();
    return !(s === 'false' || s === '0' || s === 'no' || s === 'off' || s === '');
  });

const posInt = (def: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().positive());

export interface ExportConfig {
  exportRoot: string;
  pdfTimeoutMs: number;
  pdfMaxSourceBytes: number;
  pdfMaxQueue: number;
  puppeteerExecutablePath: string | null;
  pdfNoSandbox: boolean;
}

/** Resolve the export root to an absolute path (default `<cwd>/.forge-exports`). */
export function resolveExportRootPath(raw: string | undefined): string {
  const env = raw?.trim();
  if (env) return isAbsolute(env) ? env : resolve(process.cwd(), env);
  return join(process.cwd(), '.forge-exports');
}

/** Minimal env shape (a subset of NodeJS.ProcessEnv) so tests pass plain objects. */
export type ExportEnv = Record<string, string | undefined>;

/**
 * Parse + validate the export env. Pure of side effects (no fs/db). `env`
 * defaults to `process.env` but is injectable for tests.
 */
export function loadExportConfig(env: ExportEnv = process.env): ExportConfig {
  const exportRoot = resolveExportRootPath(env.FORGE_EXPORT_ROOT);
  const pdfTimeoutMs = posInt(30_000).parse(env.FORGE_PDF_TIMEOUT_MS);
  const pdfMaxSourceBytes = posInt(5_242_880).parse(env.FORGE_PDF_MAX_SOURCE_BYTES);
  const pdfMaxQueue = posInt(8).parse(env.FORGE_PDF_MAX_QUEUE);
  const puppeteerExecutablePath =
    env.PUPPETEER_EXECUTABLE_PATH?.trim() ? env.PUPPETEER_EXECUTABLE_PATH.trim() : null;
  const pdfNoSandbox =
    env.FORGE_PDF_NO_SANDBOX === undefined ? true : boolEnv.parse(env.FORGE_PDF_NO_SANDBOX);

  return {
    exportRoot,
    pdfTimeoutMs,
    pdfMaxSourceBytes,
    pdfMaxQueue,
    puppeteerExecutablePath,
    pdfNoSandbox,
  };
}
