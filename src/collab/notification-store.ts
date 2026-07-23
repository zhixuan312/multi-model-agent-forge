/**
 * Notification store — centralised read/write for the ops_notification table.
 * All notification types (dispatch failures, mentions, approvals, system alerts)
 * go through this module. The NotificationBell consumes from here.
 */

import { eq, or, isNull, desc, and } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { notification, type NotificationRow } from '@/db/schema/ops';

// ── Handler metadata (dispatch failure context) ────────────────────

interface HandlerMeta {
  stage: string;
  phase: string;
  activity: string;
}

const HANDLER_META: Record<string, HandlerMeta> = {
  'explore-propose': { stage: 'Explore', phase: 'Discover', activity: 'Analysis failed' },
  'explore-synthesize': { stage: 'Explore', phase: 'Synthesize', activity: 'Synthesis failed' },
  'spec-auto-draft': { stage: 'Spec', phase: 'Craft', activity: 'Auto-draft failed' },
  'spec-refine': { stage: 'Spec', phase: 'Craft', activity: 'Refinement failed' },
  'spec-audit': { stage: 'Spec', phase: 'Finalize', activity: 'Audit failed' },
  'spec-audit-apply': { stage: 'Spec', phase: 'Finalize', activity: 'Revision failed' },
  'plan-author': { stage: 'Plan', phase: 'Refine', activity: 'Plan authoring failed' },
  'plan-audit': { stage: 'Plan', phase: 'Validate', activity: 'Plan audit failed' },
  'plan-audit-apply': { stage: 'Plan', phase: 'Validate', activity: 'Plan revision failed' },
  'execute-pipeline': { stage: 'Execute', phase: 'Monitor', activity: 'Execution failed' },
  'code-review': { stage: 'Review', phase: 'Review', activity: 'Code review failed' },
  'review-apply': { stage: 'Review', phase: 'Review', activity: 'Review fixes failed' },
  'journal-harvest': { stage: 'Journal', phase: 'Journal', activity: 'Harvest failed' },
  'journal-record': { stage: 'Journal', phase: 'Journal', activity: 'Record failed' },
};

function handlerMeta(handler: string): HandlerMeta {
  return HANDLER_META[handler] ?? { stage: '?', phase: '?', activity: `${handler} failed` };
}

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

export async function dismiss(id: string, memberId: string, db?: Db): Promise<void> {
  const d = db ?? getDb();
  // Same ownership scope as markRead — never dismiss another member's notification by id.
  await d
    .update(notification)
    .set({ dismissedAt: new Date() })
    .where(and(eq(notification.id, id), or(eq(notification.memberId, memberId), isNull(notification.memberId))));
}

// ── Insert ─────────────────────────────────────────────────────────

export interface CreateNotification {
  memberId?: string | null;
  kind: string;
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
