/**
 * Notification store — centralised read/write for the ops_notification table.
 *
 * The kinds are `NOTIFICATION_KIND`: a dispatch failure, a section invite, and a mention.
 * This once said "dispatch failures, mentions, approvals, system alerts" when only the
 * first existed — a docstring listing features the module does not have is worse than none,
 * because it reads as coverage. Mentions are real now (`collab/notify-mentions.ts`);
 * approvals and system alerts are still not, and are not claimed here.
 *
 * The NotificationBell consumes from here.
 */

import { eq, or, isNull, desc, and } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import type { NotificationKind } from '@/db/enums';
import { notification, type NotificationRow } from '@/db/schema/ops';
import { HANDLER_EVENT } from '@/details/project-event-labels';
import { STAGE_LABEL } from '@/projects/stage-lifecycle';

// ── Handler metadata (dispatch failure context) ────────────────────

interface HandlerMeta {
  stage: string;
  phase: string;
  activity: string;
}

/**
 * Per-handler failure phrasing + the PHASE label. The STAGE is NOT stored here — it is
 * derived from `HANDLER_EVENT` (the one handler→stage map) through `STAGE_LABEL` (the one
 * stage→display-name map), because a hand-written stage name drifts: this table said
 * "Journal" where every other surface says "Reflect", so a failed harvest notified the
 * user about a stage that appears nowhere in the UI.
 *
 * Phases stay per-handler: they are not the stage's phase keys (execute/implement shows as
 * "Monitor"), so there is nothing to derive them from. `plan-refine` was missing entirely,
 * so a failed task refinement notified with stage "?" and phase "?".
 */
const HANDLER_PHASE: Record<string, { phase: string; activity: string }> = {
  'explore-propose': { phase: 'Discover', activity: 'Analysis failed' },
  'explore-synthesize': { phase: 'Synthesize', activity: 'Synthesis failed' },
  'spec-auto-draft': { phase: 'Craft', activity: 'Auto-draft failed' },
  'spec-refine': { phase: 'Craft', activity: 'Refinement failed' },
  'spec-audit': { phase: 'Finalize', activity: 'Audit failed' },
  'spec-audit-apply': { phase: 'Finalize', activity: 'Revision failed' },
  'plan-author': { phase: 'Refine', activity: 'Plan authoring failed' },
  'plan-refine': { phase: 'Refine', activity: 'Task refinement failed' },
  'plan-audit': { phase: 'Validate', activity: 'Plan audit failed' },
  'plan-audit-apply': { phase: 'Validate', activity: 'Plan revision failed' },
  'execute-pipeline': { phase: 'Monitor', activity: 'Execution failed' },
  'code-review': { phase: 'Review', activity: 'Code review failed' },
  'review-apply': { phase: 'Review', activity: 'Review fixes failed' },
  'journal-harvest': { phase: 'Journal', activity: 'Harvest failed' },
  'journal-record': { phase: 'Journal', activity: 'Record failed' },
};

function handlerMeta(handler: string): HandlerMeta {
  const kind = HANDLER_EVENT[handler]?.stage;
  const local = HANDLER_PHASE[handler];
  return {
    stage: kind ? STAGE_LABEL[kind] : '?',
    phase: local?.phase ?? '?',
    activity: local?.activity ?? `${handler} failed`,
  };
}

/** Test seam: the resolved (stage, phase, activity) a failure notification would render. */
export const notificationMetaForTest = handlerMeta;

// ── Queries ────────────────────────────────────────────────────────

export async function listNotifications(
  memberId: string,
  opts?: { db?: Db; limit?: number },
): Promise<NotificationRow[]> {
  const db = opts?.db ?? getDb();
  return db
    .select()
    .from(notification)
    .where(
      and(
        or(eq(notification.memberId, memberId), isNull(notification.memberId)),
        isNull(notification.dismissedAt),
      ),
    )
    .orderBy(desc(notification.createdAt))
    .limit(opts?.limit ?? 50);
}

export async function markRead(id: string, memberId: string, db?: Db): Promise<void> {
  const d = db ?? getDb();
  // Scope by the caller: a member may only mark their OWN notifications (or a broadcast, where
  // member_id is null) — without this, any authenticated caller could mark any notification by id.
  await d
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(eq(notification.id, id), or(eq(notification.memberId, memberId), isNull(notification.memberId))));
}

export async function markAllRead(memberId: string | null, db?: Db): Promise<void> {
  const d = db ?? getDb();
  await d
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        memberId ? eq(notification.memberId, memberId) : isNull(notification.memberId),
        isNull(notification.readAt),
      ),
    );
}

// ── Insert ─────────────────────────────────────────────────────────

export interface CreateNotification {
  memberId?: string | null;
  /** Typed, so a call site cannot invent a kind no reader knows about. */
  kind: NotificationKind;
  title: string;
  subtitle?: string;
  sourceId?: string;
}

export async function insertNotification(n: CreateNotification, db?: Db): Promise<string> {
  const d = db ?? getDb();
  const [row] = await d
    .insert(notification)
    .values({
      memberId: n.memberId ?? null,
      kind: n.kind,
      title: n.title,
      subtitle: n.subtitle ?? null,
      sourceId: n.sourceId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: notification.id });
  return row?.id ?? '';
}

// ── Convenience: dispatch failure ──────────────────────────────────

export interface DispatchFailureInfo {
  projectId: string;
  projectName: string;
  /** The project owner — the notification's recipient. */
  ownerId: string | null;
  handler: string;
  batchId: string;
}

/**
 * Notify the PROJECT OWNER that a batch failed. Previously this inserted a broadcast
 * (memberId=null), and listNotifications returns broadcasts to every member of every
 * team — so a failure on team A's project leaked its project name into team B's feed.
 * ops_notification has no team_id column, so we scope by targeting the owner (who is
 * on the project's team) instead of broadcasting. No owner → no notification (never
 * fall back to a global broadcast).
 */
export async function pushDispatchFailure(info: DispatchFailureInfo, db?: Db): Promise<void> {
  if (!info.ownerId) return;
  const meta = handlerMeta(info.handler);
  const parts = [info.projectName, meta.stage, meta.phase].filter(Boolean);
  await insertNotification({
    memberId: info.ownerId,
    kind: 'dispatch_failed',
    title: meta.activity,
    subtitle: parts.join(' · '),
    sourceId: `batch:${info.batchId}`,
  }, db);
}
