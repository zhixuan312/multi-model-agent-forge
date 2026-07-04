import type { Db } from '@/db/client';
import { resolveRunningEvent } from '@/details/write';
import { projectEventBus } from '@/sse/event-bus';

/**
 * Friendly project-event label + stage/phase for each MMA handler. This is the
 * single source that turns a batch's terminal into one human line on the
 * project-level activity log (`details.events`), so the log reads as a full
 * timeline across every stage (explore→journal) — regardless of whether the
 * batch was fired by the manual UI or the auto driver.
 *
 * Handlers absent from this map (none today) simply produce no timeline line.
 */
const HANDLER_EVENT: Record<string, { stage: string; phase: string; label: string }> = {
  'explore-propose':    { stage: 'exploration', phase: 'discover',   label: 'Proposed exploration tasks' },
  'explore-synthesize': { stage: 'exploration', phase: 'synthesize', label: 'Synthesized exploration brief' },
  'spec-auto-draft':    { stage: 'spec',        phase: 'craft',      label: 'Drafted spec' },
  'spec-refine':        { stage: 'spec',        phase: 'craft',      label: 'Refined spec component' },
  'spec-learnings':     { stage: 'spec',        phase: 'craft',      label: 'Recalled relevant learnings' },
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
  status: 'done' | 'failed',
  durationMs?: number,
): Promise<void> {
  if (!projectId || !handler) return;
  const meta = HANDLER_EVENT[handler];
  if (!meta) return;
  const detail = status === 'failed' ? `${meta.label} — failed` : meta.label;
  const kind = status === 'failed' ? 'error' : 'done';
  await resolveRunningEvent(db, projectId, { stage: meta.stage, phase: meta.phase, detail, kind, durationMs });
  // Surface the resolution live too, so an open automation overlay finalizes its
  // running line in place (same shape the driver publishes; the durable resolve
  // above covers a refresh).
  projectEventBus.publish(projectId, { type: 'automation.progress', note: detail, stage: meta.stage, phase: meta.phase, kind, durationMs });
}
