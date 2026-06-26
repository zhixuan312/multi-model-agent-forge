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

  // Install the main-agent diagnostics sink so analysis/synthesis token usage
  // is recorded as mma_batch rows (route='orchestrate') in the same pipeline as
  // worker calls. Non-fatal — a sink failure never blocks the orchestrator call.
  try {
    const { setAnthropicDiagnosticsSink } = await import('@/anthropic/client');
    const { getDb } = await import('@/db/client');
    const { mmaBatch } = await import('@/db/schema/mma');
    const { resolveWorkspaceRoot } = await import('@/git/workspace-root');

    const workspaceRoot = resolveWorkspaceRoot();
    console.log(JSON.stringify({ event: 'diagnostics_sink_installed' }));

    setAnthropicDiagnosticsSink((record) => {
      try {
        if (!record.projectId) return;
        const inputTokens = record.inputTokens ?? 0;
        const cacheRead = record.cacheReadInputTokens ?? 0;
        const cacheCreate = record.cacheCreationInputTokens ?? 0;
        const outputTokens = record.outputTokens ?? 0;
        const costUsd =
          (inputTokens * 5 + cacheRead * 0.5 + cacheCreate * 6.25 + outputTokens * 25) / 1_000_000;
        console.log(JSON.stringify({ event: 'diagnostics_sink_record', call: record.call, projectId: record.projectId, inputTokens, outputTokens, costUsd: costUsd.toFixed(6) }));
        getDb().insert(mmaBatch)
          .values({
            projectId: record.projectId,
            route: 'orchestrate' as const,
            cwd: workspaceRoot,
            status: record.ok ? ('done' as const) : ('failed' as const),
            request: { call: record.call },
            result: record.ok ? {} : { error: record.error },
            inputTokens: inputTokens + cacheRead + cacheCreate,
            outputTokens,
            costUsd: costUsd.toFixed(6),
            durationMs: record.latencyMs,
            implementerTier: 'main',
            terminalAt: new Date(),
          })
          .execute()
          .then(() => console.log(JSON.stringify({ event: 'diagnostics_sink_inserted', call: record.call })))
          .catch((err) => console.warn(JSON.stringify({ event: 'diagnostics_sink_insert_failed', error: err instanceof Error ? err.message : String(err) })));
      } catch (err) {
        console.warn(JSON.stringify({ event: 'diagnostics_sink_sync_error', error: err instanceof Error ? err.message : String(err) }));
      }
    });
  } catch (e) {
    console.warn(JSON.stringify({ event: 'diagnostics_sink_deferred', reason: e instanceof Error ? e.message : String(e) }));
  }

  // Rehydrate in-flight MMA batches so the PollManager resumes polling after
  // a server restart. Stale batches (MMA returned 404) will be failed on their
  // first poll — this is the self-recovery path.
  try {
    const { getPollManager } = await import('@/sse/poll-manager');
    const n = await getPollManager().rehydrate();
    if (n > 0) console.log(JSON.stringify({ event: 'poll_manager_rehydrated', batches: n }));
  } catch (e) {
    console.warn(JSON.stringify({ event: 'poll_manager_rehydrate_deferred', reason: e instanceof Error ? e.message : String(e) }));
  }

  // Sweep any project whose Exploration tasks all completed but whose synthesis
  // never ran (e.g. a restart between dispatch and synthesis). Non-fatal.
  try {
    const { getSynthesisScheduler } = await import('@/exploration/synthesis-scheduler');
    const swept = await getSynthesisScheduler().reconcileOnBoot();
    if (swept.length) console.log(JSON.stringify({ event: 'synthesis_reconciled', projects: swept.length }));
  } catch (e) {
    console.warn(
      JSON.stringify({ event: 'synthesis_reconcile_deferred', reason: e instanceof Error ? e.message : String(e) }),
    );
  }
}
