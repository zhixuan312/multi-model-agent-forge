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

export async function markRead(id: string, db?: Db): Promise<void> {
  const d = db ?? getDb();
  await d.update(notification).set({ readAt: new Date() }).where(eq(notification.id, id));
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

export async function dismiss(id: string, db?: Db): Promise<void> {
  const d = db ?? getDb();
  await d.update(notification).set({ dismissedAt: new Date() }).where(eq(notification.id, id));
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
  handler: string;
  batchId: string;
}

export async function pushDispatchFailure(info: DispatchFailureInfo, db?: Db): Promise<void> {
  const meta = handlerMeta(info.handler);
  const parts = [info.projectName, meta.stage, meta.phase].filter(Boolean);
  await insertNotification({
    memberId: null,
    kind: 'dispatch_failed',
    title: meta.activity,
    subtitle: parts.join(' · '),
    sourceId: `batch:${info.batchId}`,
  }, db);
}
