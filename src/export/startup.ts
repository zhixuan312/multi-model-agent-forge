/**
 * Boot wiring for the export service (Spec 8 §In-scope #10, F6/F8/F29). Called
 * from Next 16's `instrumentation.ts` `register()`.
 *
 *  (a) PATH INVARIANT (fatal): create the export root if missing, assert it is
 *      writable, and assert it is DISJOINT from every registered repo path
 *      (`SELECT path_on_disk FROM repo` — the global `repo` table, F24). A
 *      violation throws → boot fails loudly.
 *  (b) HEALTH PROBE (non-fatal): launch + close a browser once to surface a
 *      broken Chromium dep early. A failed probe only logs `pdf_engine_unavailable`;
 *      it never blocks boot.
 *
 * The repo-path read + probe are injectable so the boot logic is unit-testable
 * without a live DB / Chromium.
 */
import { mkdir, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { loadExportConfig, type ExportConfig } from '@/export/config';
import { assertExportRootDisjoint } from '@/export/export-root';
import { getPdfRenderer } from '@/export/pdf/render';

export interface StartupDeps {
  config?: ExportConfig;
  /** Returns every `repo.path_on_disk`. Default: queries the global `repo` table. */
  repoPaths?: () => Promise<string[]>;
  /** The boot health probe. Default: the singleton PdfRenderer's probe(). */
  probe?: () => Promise<boolean>;
  log?: (entry: { event: string; [k: string]: unknown }) => void;
}

/** Default repo-path source: `SELECT path_on_disk FROM repo` (F24). */
async function defaultRepoPaths(): Promise<string[]> {
  const { getDb } = await import('@/db/client');
  const { repo } = await import('@/db/schema/workspace');
  const rows = await getDb().select({ p: repo.pathOnDisk }).from(repo);
  return rows.map((r) => r.p);
}

/**
 * Run the export-service boot invariants. The path invariant is FATAL (throws);
 * the probe is non-fatal (logged). Returns the probe outcome for visibility.
 */
export async function runExportStartup(deps: StartupDeps = {}): Promise<{ probeOk: boolean }> {
  const cfg = deps.config ?? loadExportConfig();
  const log = deps.log ?? ((e) => console.log(JSON.stringify(e)));
  const repoPaths = deps.repoPaths ?? defaultRepoPaths;

  // (a) Path invariant — FATAL on violation.
  await mkdir(cfg.exportRoot, { recursive: true, mode: 0o700 });
  await access(cfg.exportRoot, FS.W_OK); // throws if not writable
  const paths = await repoPaths();
  assertExportRootDisjoint(cfg.exportRoot, paths); // throws ExportPathError on overlap

  // (b) Health probe — NON-fatal.
  let probeOk = false;
  try {
    const probe = deps.probe ?? (() => getPdfRenderer().probe());
    probeOk = await probe();
    if (!probeOk) log({ event: 'pdf_engine_unavailable', stage: 'startup' });
    else log({ event: 'pdf_engine_ready', stage: 'startup' });
  } catch (e) {
    // A probe exception is still non-fatal.
    log({ event: 'pdf_engine_unavailable', stage: 'startup', error: String(e) });
    probeOk = false;
  }

  return { probeOk };
}
