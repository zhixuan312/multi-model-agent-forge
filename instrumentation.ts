/**
 * Next 16 server-init hook (Spec 8 §In-scope #10, F6/F29). Wires the boot-time
 * invariants and recovery sweeps: the export-root path invariant (fatal on a
 * repo-overlap) + the non-fatal Chromium health probe, poll-manager rehydration,
 * exploration-synthesis reconcile, and automation resume.
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
      // The only fatal boot path. `startup.fatal` existed in the catalog but nothing
      // emitted it, so a boot that died here left only an unstructured stack trace.
      const { logEvent } = await import('@/observability/log-event');
      logEvent({ event: 'startup.fatal', level: 'error', detail: msg });
      throw e; // fatal: export root overlaps a repo working tree
    }
    console.warn(JSON.stringify({ event: 'export_startup_deferred', reason: msg }));
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

  // Resume server-side automation for projects with auto_mode = true (legacy)
  // OR details.automation.status = 'running' (details-ready path)
  try {
    const { getDb } = await import('@/db/client');
    const { project } = await import('@/db/schema/projects');
    const { eq, or, sql } = await import('drizzle-orm');
    const { driveProject } = await import('@/automation/driver');
    const db = getDb();
    const autoProjects = await db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(or(
        eq(project.autoMode, true),
        sql`${project.details}->'automation'->>'status' = 'running'`,
      ));
    for (const p of autoProjects) {
      console.log(JSON.stringify({ event: 'automation_resumed', projectId: p.id, name: p.name }));
      driveProject(p.id).catch((err) => {
        console.warn(JSON.stringify({ event: 'automation_resume_failed', projectId: p.id, error: err instanceof Error ? err.message : String(err) }));
      });
    }
  } catch (e) {
    console.warn(JSON.stringify({ event: 'automation_resume_deferred', reason: e instanceof Error ? e.message : String(e) }));
  }
}
