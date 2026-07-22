import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { repo } from '@/db/schema/workspace';
import { project } from '@/db/schema/projects';
import { validateDetails, type Details } from '@/details/schema';
import { FORGE_MEMBER_ID } from '@/automation/forge-member';
import { recordActivity, resolveRunningActivity } from '@/activity/project-activity';
import { projectEventBus } from '@/sse/event-bus';

/**
 * Friendly project-event label + stage/phase for each MMA handler. This is the
 * single source that turns a batch's terminal into one human line on the
 * project-level activity log (`project_activity`), so the log reads as a full
 * timeline across every stage (explore→journal) — regardless of whether the
 * batch was fired by the manual UI or the auto driver.
 *
 * Handlers absent from this map (none today) simply produce no timeline line.
 */
export const HANDLER_EVENT: Record<string, { stage: string; phase: string; label: string }> = {
  'explore-propose':    { stage: 'exploration', phase: 'discover',   label: 'Proposed exploration tasks' },
  'explore-synthesize': { stage: 'exploration', phase: 'synthesize', label: 'Synthesized exploration brief' },
  'spec-auto-draft':    { stage: 'spec',        phase: 'craft',      label: 'Drafted spec' },
  'spec-refine':        { stage: 'spec',        phase: 'craft',      label: 'Refined spec component' },
  'spec-audit':         { stage: 'spec',        phase: 'finalize',   label: 'Audited spec' },
  'spec-audit-apply':   { stage: 'spec',        phase: 'finalize',   label: 'Applied spec audit findings' },
  'plan-author':        { stage: 'plan',        phase: 'refine',     label: 'Authored plan' },
  'plan-refine':        { stage: 'plan',        phase: 'refine',     label: 'Refined plan task' },
  'plan-audit':         { stage: 'plan',        phase: 'validate',   label: 'Audited plan' },
  'plan-audit-apply':   { stage: 'plan',        phase: 'validate',   label: 'Applied plan audit findings' },
  'execute-pipeline':   { stage: 'execute',     phase: 'implement',  label: 'Executed plan tasks' },
  'code-review':        { stage: 'review',      phase: 'review',     label: 'Reviewed code' },
  'review-apply':       { stage: 'review',      phase: 'review',     label: 'Applied review findings' },
  'journal-harvest':    { stage: 'journal',     phase: 'journal',    label: 'Harvested learnings' },
  'journal-record':     { stage: 'journal',     phase: 'journal',    label: 'Recorded learnings to journal' },
};

/**
 * Audit handlers whose durable terminal line should carry the pass just recorded, so the
 * persisted timeline keeps the detail the LIVE progression showed ("Audited spec — pass 2 ·
 * revised") instead of collapsing to a bare "Audited spec" after navigation. Only the two
 * stage-level audit loops qualify (review passes are per-repo, so no single pass number).
 */
const AUDIT_PASSES: Record<string, (d: Details) => Array<{ passNo: number; status: string }>> = {
  'spec-audit': (d) => d.stages.spec.phases.finalize.auditPasses,
  'plan-audit': (d) => d.stages.plan.phases.validate.auditPasses,
};

/** Append "— pass N · <status>" to an audit label from the latest recorded pass (pure). */
export function auditTerminalLabel(baseLabel: string, passes: Array<{ passNo: number; status: string }>): string {
  const last = passes[passes.length - 1];
  return last ? `${baseLabel} — pass ${last.passNo} · ${last.status}` : baseLabel;
}

/**
 * Singleton handlers that reject concurrent dispatch of the same handler.
 * These represent unique orchestration steps that should not run in parallel.
 */
export const SINGLETON_HANDLERS = new Set([
  'spec-auto-draft',
  'explore-synthesize',
  'plan-author',
  'journal-harvest',
]);

/**
 * The `(stage, phase)` an MMA handler belongs to — the SINGLE source (shared with
 * the activity-log labels) used by the per-(project, phase) concurrency guard (G2):
 * two batches conflict iff they belong to DIFFERENT phases. Returns a stable
 * `"<stage>/<phase>"` key, or `null` for a handler with no phase (e.g. the global
 * `journal-recall`, which is not project-scoped and so is never guarded).
 */
export function phaseKeyForHandler(handler: string | null | undefined): string | null {
  if (!handler) return null;
  const m = HANDLER_EVENT[handler];
  return m ? `${m.stage}/${m.phase}` : null;
}

const FOCUS_MAX = 60;

/**
 * Distill a compact focus for the activity label — the short `title` the propose
 * orchestrator now emits per task, or, when absent (manual-add tasks, and discover
 * tasks predating the title field), the first sentence of the prompt trimmed to a
 * label-sized fragment. Returns null when there is nothing usable, so the caller
 * falls back to the bare verb.
 */
function deriveFocus(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const firstSentence = text.split(/(?<=[.?!])\s/)[0] ?? text;
  const clipped = firstSentence.length <= FOCUS_MAX
    ? firstSentence
    : `${firstSentence.slice(0, FOCUS_MAX - 1).trimEnd()}…`;
  const focus = clipped.replace(/[.?!]+$/, '').trim();
  return focus || null;
}

export async function buildDiscoverTerminalLabel(
  db: Db,
  batchRequest: Record<string, unknown>,
): Promise<string> {
  const taskKind = typeof batchRequest.taskKind === 'string' ? batchRequest.taskKind : null;
  // Prefer the propose-time title; fall back to a focus derived from the prompt so
  // sibling tasks of the same kind never collapse into identical lines.
  const focus = deriveFocus(batchRequest.title) ?? deriveFocus(batchRequest.prompt);
  if (taskKind === 'research') return focus ? `Researched — ${focus}` : 'Researched';
  if (taskKind === 'journal') return focus ? `Recalled — ${focus}` : 'Recalled learnings';
  const targetRepoId = typeof batchRequest.targetRepoId === 'string' ? batchRequest.targetRepoId : null;
  let base = 'Investigated a repository';
  if (targetRepoId) {
    const [row] = await db
      .select({ name: repo.name })
      .from(repo)
      .where(eq(repo.id, targetRepoId))
      .limit(1);
    const name = row?.name?.trim();
    if (name) base = `Investigated ${name}`;
  }
  return focus ? `${base} — ${focus}` : base;
}

/**
 * Resolve the running activity line when an MMA batch reaches a terminal state —
 * turning the driver's live "Running X…" line into the settled milestone with its
 * measured duration (one line per activity, no start/finish pair). Called from
 * BOTH terminal paths — the sync `dispatchMma` path AND the async `PollManager` —
 * so the log is complete no matter which dispatch mode a handler used, and covers
 * manual-UI batches (which the auto driver never announced → a fresh line).
 * Best-effort (never throws into the caller).
 */
export async function appendBatchTerminalEvent(
  db: Db,
  projectId: string | null | undefined,
  handler: string | null | undefined,
  batchRowId: string,
  status: 'done' | 'failed',
  durationMs?: number,
): Promise<void> {
  if (!projectId || !handler) return;
  const meta = HANDLER_EVENT[handler];
  if (!meta) return;
  let label = status === 'failed' ? `${meta.label} — failed` : meta.label;
  // Enrich a successful audit terminal with the pass it just recorded, so the durable line
  // reads "Audited spec — pass 2 · revised" (the detail the live SSE progression showed) rather
  // than a bare "Audited spec" once you navigate away and back. The handler wrote the pass to
  // `details` before this resolves, so it is readable here; best-effort (keep the base on any miss).
  const readPasses = AUDIT_PASSES[handler];
  if (status === 'done' && readPasses) {
    try {
      const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
      if (row?.details) label = auditTerminalLabel(meta.label, readPasses(validateDetails(row.details)));
    } catch { /* keep the base label */ }
  }
  const kind = status === 'failed' ? 'error' : 'done';
  const eventKey = `${handler}:${batchRowId}`;
  const resolved = await resolveRunningActivity({
    db,
    projectId,
    eventKey,
    status: kind,
    durationMs,
    label,
  });
  // Narrow, tracked-batch-only fallback (FR-4/FR-6): if no running row existed for this
  // key (e.g. a legacy/manual dispatch whose running row was never written), insert ONE
  // terminal row under the SAME event_key rather than letting the terminal vanish. This
  // path is reachable only here — never from user seams or discover rows.
  if (resolved === 0) {
    await recordActivity({
      db,
      projectId,
      stage: meta.stage,
      phase: meta.phase,
      label,
      kind,
      actor: { id: FORGE_MEMBER_ID, name: 'Forge', tint: '#9a6b4f' },
      source: 'mma',
      durationMs,
      eventKey,
    });
  }
  projectEventBus.publish(projectId, {
    type: 'automation.progress',
    note: label,
    stage: meta.stage,
    phase: meta.phase,
    kind,
    durationMs,
  });
}
