import { and, asc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { component, componentSection, qaMessage } from '@/db/schema/spec';
import type { ComponentStatus } from '@/db/enums';
import { logAction } from '@/observability/action-log';
import { deriveSummary } from '@/spec/summary';
import { templateForKind } from '@/spec/components';
import type { ComponentKind } from '@/db/enums';

/**
 * Spec-stage core — RSC-facing reads, lazy stage lifecycle, and intent capture.
 * Component lifecycle in `orchestrator.ts`; assemble in `assemble.ts`. Membership
 * enforced by the route/page caller via `assertProjectReadable`.
 */

/** Resolve (lazily creating) the spec stage row for a project. Sets status='active' on creation (F10). */
export async function ensureSpecStage(db: Db, projectId: string): Promise<{ id: string; status: string; approvers: unknown }> {
  const dbi = db ?? getDb();
  const [existing] = await dbi
    .select({ id: stage.id, status: stage.status, approvers: stage.approvers })
    .from(stage)
    .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'spec')))
    .limit(1);
  if (existing) {
    if (existing.status === 'pending') {
      await dbi
        .update(stage)
        .set({ status: 'active', startedAt: new Date() })
        .where(eq(stage.id, existing.id));
      return { id: existing.id, status: 'active', approvers: existing.approvers };
    }
    return existing;
  }
  // No spec stage yet (defensive — Spec 3 seeds all five): create it active.
  const [row] = await dbi
    .insert(stage)
    .values({ projectId, kind: 'spec', status: 'active', startedAt: new Date() })
    .returning({ id: stage.id, status: stage.status, approvers: stage.approvers });
  return row;
}

/** Capture / update the project intent and derive the summary (pure, no LLM). */
export async function captureIntent(
  db: Db,
  projectId: string,
  intentMd: string,
  actorId: string,
): Promise<void> {
  const dbi = db ?? getDb();
  await dbi
    .update(project)
    .set({ intentMd, summary: deriveSummary(intentMd), updatedAt: new Date() })
    .where(eq(project.id, projectId));
  await logAction(
    { projectId, memberId: actorId, action: 'capture_intent', target: `project:${projectId}` },
    dbi,
  );
}

/* ── Read DTOs for the interview islands ────────────────────────────────── */

export interface SectionView {
  id: string;
  key: string;
  label: string;
  draftMd: string | null;
  orderIndex: number;
}

export interface ComponentView {
  id: string;
  kind: ComponentKind;
  label: string;
  primaryRoles: string[];
  status: ComponentStatus;
  aiSatisfied: boolean;
  humanSatisfied: boolean;
  forced: boolean;
  stale: boolean;
  approvedBy: string[];
  mmaSessionId: string | null;
  participantIds: string[];
  orderIndex: number;
  sections: SectionView[];
}

/** Load the full component/section outline for a project's spec stage, ordered. */
export async function loadOutline(db: Db, stageId: string): Promise<ComponentView[]> {
  const dbi = db ?? getDb();
  const comps = await dbi
    .select()
    .from(component)
    .where(eq(component.stageId, stageId))
    .orderBy(asc(component.orderIndex));

  const views: ComponentView[] = [];
  for (const c of comps) {
    const secs = await dbi
      .select()
      .from(componentSection)
      .where(eq(componentSection.componentId, c.id))
      .orderBy(asc(componentSection.orderIndex));
    views.push({
      id: c.id,
      kind: c.kind as ComponentKind,
      label: templateForKind(c.kind as ComponentKind).label,
      primaryRoles: c.primaryRoles,
      status: c.status as ComponentStatus,
      aiSatisfied: c.aiSatisfied,
      humanSatisfied: c.humanSatisfied,
      forced: c.forced,
      stale: c.stale,
      approvedBy: (c.approvedBy as string[] | null) ?? [],
      mmaSessionId: c.mmaSessionId,
      participantIds: (c.participants as string[] | null) ?? [],
      orderIndex: c.orderIndex,
      sections: secs.map((s) => ({
        id: s.id,
        key: s.key,
        label: s.label,
        draftMd: s.draftMd,
        orderIndex: s.orderIndex,
      })),
    });
  }
  return views;
}

/** The repaint payload returned by the answer/force/nod handlers (F29). */
export interface SectionRepaint {
  component: {
    status: ComponentStatus;
    aiSatisfied: boolean;
    humanSatisfied: boolean;
    forced: boolean;
    stale: boolean;
  };
  qaMessages: Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string }>;
}

/** Build the repaint payload for a component after a mutation. */
export async function buildSectionRepaint(db: Db, sectionId: string): Promise<SectionRepaint> {
  const dbi = db ?? getDb();
  const [s] = await dbi
    .select({ componentId: componentSection.componentId })
    .from(componentSection)
    .where(eq(componentSection.id, sectionId))
    .limit(1);
  if (!s) throw new Error(`No component_section '${sectionId}'.`);
  const [c] = await dbi
    .select()
    .from(component)
    .where(eq(component.id, s.componentId))
    .limit(1);
  if (!c) throw new Error(`No component '${s.componentId}'.`);
  return {
    component: {
      status: c.status as ComponentStatus,
      aiSatisfied: c.aiSatisfied,
      humanSatisfied: c.humanSatisfied,
      forced: c.forced,
      stale: c.stale,
    },
    qaMessages: await loadComponentMessages(dbi, s.componentId),
  };
}

/** Load all qa_messages for every component in a stage, keyed by componentId. */
export async function loadAllMessages(
  db: Db,
  stageId: string,
): Promise<Record<string, Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string; authorId: string | null }>>> {
  const rows = await db
    .select({ id: qaMessage.id, componentId: qaMessage.componentId, sender: qaMessage.sender, bodyMd: qaMessage.bodyMd, authorId: qaMessage.authorId, seq: qaMessage.seq })
    .from(qaMessage)
    .innerJoin(component, eq(qaMessage.componentId, component.id))
    .where(eq(component.stageId, stageId))
    .orderBy(qaMessage.seq);
  const result: Record<string, Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string; authorId: string | null }>> = {};
  for (const r of rows) {
    if (!r.componentId) continue;
    const list = result[r.componentId] ?? [];
    list.push({ id: r.id, sender: r.sender as 'forge' | 'member', bodyMd: r.bodyMd, authorId: r.authorId });
    result[r.componentId] = list;
  }
  return result;
}

export async function loadComponentMessages(
  db: Db,
  componentId: string,
): Promise<Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string }>> {
  const dbi = db ?? getDb();
  const rows = await dbi
    .select({ id: qaMessage.id, sender: qaMessage.sender, bodyMd: qaMessage.bodyMd })
    .from(qaMessage)
    .where(eq(qaMessage.componentId, componentId))
    .orderBy(asc(qaMessage.seq));
  return rows.map((r) => ({ id: r.id, sender: r.sender as 'forge' | 'member', bodyMd: r.bodyMd }));
}
