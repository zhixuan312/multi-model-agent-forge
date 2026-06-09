/**
 * Next 16 server-init hook (Spec 8 §In-scope #10, F6/F29). Wires the export
 * service boot invariants — the export-root path invariant (fatal on a
 * repo-overlap) + the non-fatal Chromium health probe — at server start, the
 * same place the Forge MMA config-supervisor (Spec 2) is wired.
 *
 * Runs only on the Node.js server runtime (not Edge, not the build's static
 * analysis). A DB-unavailable boot (no repos to read) is tolerated so local
 * `next build` / first-run does not hard-fail before migrations.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { runExportStartup } = await import('@/export/startup');
  try {
    await runExportStartup();
  } catch (e) {
    // The path-invariant violation is intentionally fatal — rethrow it so a
    // misconfigured FORGE_EXPORT_ROOT fails boot loudly. A transient
    // DB-unavailable error (no repo table yet) is downgraded to a warning.
    const msg = e instanceof Error ? e.message : String(e);
    if (e && (e as { name?: string }).name === 'ExportPathError') {
      throw e; // fatal: export root overlaps a repo working tree
    }
    console.warn(JSON.stringify({ event: 'export_startup_deferred', reason: msg }));
  }
}
