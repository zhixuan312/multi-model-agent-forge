import { logEvent } from '@/observability/log-event';
import { errMessage } from '@/lib/err';

/**
 * Next 16 server-init hook (Spec 8 §In-scope #10, F6/F29). Wires the boot-time
 * invariants and recovery sweeps: the export-root path invariant (fatal on a
 * repo-overlap) + the non-fatal Chromium health probe, poll-manager rehydration,
 * exploration-synthesis reconcile, the loop scheduler, and automation resume.
 *
 * Runs only on the Node.js server runtime (not Edge, not the build's static
 * analysis). A DB-unavailable boot (no repos to read) is tolerated so local
 * `next build` / first-run does not hard-fail before migrations.
 *
 * Every step reports through `logEvent`. These used to be raw
 * `console.log(JSON.stringify({ event: 'snake_case', … }))` — a second structured-log
 * shape with no `ts`, no `level` and no swappable sink, which also meant none of this
 * was observable from a test.
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
    const detail = errMessage(e);
    if (e && (e as { name?: string }).name === 'ExportPathError') {
      logEvent({ event: 'startup.fatal', level: 'error', detail });
      throw e; // fatal: export root overlaps a repo working tree
    }
    logEvent({ event: 'startup.export_deferred', level: 'warn', detail });
  }

  // Rehydrate in-flight MMA batches so the PollManager resumes polling after
  // a server restart. Stale batches (MMA returned 404) will be failed on their
  // first poll — this is the self-recovery path.
  try {
    const { getPollManager } = await import('@/sse/poll-manager');
    const count = await getPollManager().rehydrate();
    if (count > 0) logEvent({ event: 'startup.poll_manager_rehydrated', count });
  } catch (e) {
    logEvent({ event: 'startup.poll_manager_deferred', level: 'warn', detail: errMessage(e) });
  }

  // Sweep any project whose Exploration tasks all completed but whose synthesis
  // never ran (e.g. a restart between dispatch and synthesis). Non-fatal.
  try {
    const { getSynthesisScheduler } = await import('@/exploration/synthesis-scheduler');
    const swept = await getSynthesisScheduler().reconcileOnBoot();
    if (swept.length) logEvent({ event: 'startup.synthesis_reconciled', count: swept.length });
  } catch (e) {
    logEvent({ event: 'startup.synthesis_deferred', level: 'warn', detail: errMessage(e) });
  }

  // Tick the Loops scheduler in-process, so `recurring` loops actually fire.
  //
  // They previously did not: `startLoopWorker` is reachable only through
  // `pnpm loop-worker`, and nothing starts that — not the Dockerfile, not
  // `container-supervisor.mjs` (which spawns exactly `mma serve` and the Forge
  // server). `event` loops were unaffected because they arrive over HTTP at
  // /api/loops/[id]/events, so the gap was invisible except to the cron ones:
  // an admin could create an enabled loop with a valid cron expression and it
  // would sit there forever.
  //
  // In-process is consistent with how this file already resumes automation, and
  // with the image's one-Forge-process model. Set FORGE_DISABLE_LOOP_SCHEDULER=true
  // when running `pnpm loop-worker` as a separate process, so the two don't both tick.
  if (process.env.FORGE_DISABLE_LOOP_SCHEDULER !== 'true') {
    try {
      const { startLoopWorker } = await import('@/loops/scheduler');
      startLoopWorker();
      logEvent({ event: 'startup.loop_scheduler_started' });
    } catch (e) {
      logEvent({ event: 'startup.loop_scheduler_deferred', level: 'warn', detail: errMessage(e) });
    }
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
      logEvent({ event: 'startup.automation_resumed', projectId: p.id, detail: p.name });
      driveProject(p.id).catch((err) => {
        logEvent({
          event: 'startup.automation_resume_failed',
          level: 'warn',
          projectId: p.id,
          detail: errMessage(err),
        });
      });
    }
  } catch (e) {
    logEvent({ event: 'startup.automation_deferred', level: 'warn', detail: errMessage(e) });
  }
}
