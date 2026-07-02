import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { participant } from '@/db/schema/participants';
import { component, componentSection, qaMessage } from '@/db/schema/spec';
import { readSpecFileAsync } from '@/projects/project-files';
import { parseSpecSections } from '@/spec/spec-file-ops';
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

/** Resolve (lazily creating) the spec stage row for a project. Sets status='active' on creation. */
export async function ensureSpecStage(db: Db, projectId: string): Promise<{ id: string; status: string; approvers: string[] }> {
  const dbi = db ?? getDb();
  const [existing] = await dbi
    .select({ id: stage.id, status: stage.status })
    .from(stage)
    .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'spec')))
    .limit(1);

  let stageId: string;
  let stageStatus: string;

  if (existing) {
    stageId = existing.id;
    stageStatus = existing.status;
    if (existing.status === 'pending') {
      await dbi
        .update(stage)
        .set({ status: 'active', startedAt: new Date() })
        .where(eq(stage.id, existing.id));
      stageStatus = 'active';
    }
  } else {
    const [row] = await dbi
      .insert(stage)
      .values({ projectId, kind: 'spec', status: 'active', startedAt: new Date() })
      .returning({ id: stage.id, status: stage.status });
    stageId = row.id;
    stageStatus = row.status;
  }

  const approverRows = await dbi
    .select({ memberId: participant.memberId })
    .from(participant)
    .where(and(eq(participant.scope, 'stage'), eq(participant.scopeId, stageId), eq(participant.role, 'approver')));

  return { id: stageId, status: stageStatus, approvers: approverRows.map((r) => r.memberId) };
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

/** Load the full component/section outline for a project's spec stage, ordered.
 * Section content comes from spec.md (file = source of truth), metadata from DB. */
export async function loadOutline(db: Db, stageId: string, projectId?: string): Promise<ComponentView[]> {
  const dbi = db ?? getDb();
  const comps = await dbi
    .select()
    .from(component)
    .where(eq(component.stageId, stageId))
    .orderBy(asc(component.orderIndex));

  // Read section content from spec.md (file = source of truth)
  // Map at ## Component level — all content under a ## heading belongs to that component
  let fileComponentContent: Map<string, string> = new Map();
  let specFileExists = false;
  if (projectId) {
    const specFile = await readSpecFileAsync(projectId);
    if (specFile) {
      specFileExists = true;
      const parsed = parseSpecSections(specFile.bodyMd);
      const compGroups = new Map<string, string[]>();
      for (const s of parsed) {
        const comp = s.component.toLowerCase();
        const group = compGroups.get(comp) ?? [];
        group.push(`${s.heading}\n\n${s.body}`);
        compGroups.set(comp, group);
      }
      for (const [comp, parts] of compGroups) {
        fileComponentContent.set(comp, parts.join('\n\n'));
      }
    }
  }

  // If spec.md was deleted but components are still marked drafted/approved,
  // reset them to gathering so auto-draft re-triggers. Clear stale conversation
  // and approvals — they belong to the previous draft cycle.
  if (!specFileExists) {
    const draftedIds = comps.filter((c) => c.status === 'drafted' || c.status === 'approved').map((c) => c.id);
    if (draftedIds.length > 0) {
      await dbi
        .update(component)
        .set({ status: 'gathering', aiSatisfied: false, humanSatisfied: false })
        .where(inArray(component.id, draftedIds));
      await dbi.delete(qaMessage).where(inArray(qaMessage.componentId, draftedIds));
      await dbi
        .delete(participant)
        .where(and(eq(participant.scope, 'component'), inArray(participant.scopeId, draftedIds), eq(participant.role, 'approver')));
      for (const c of comps) {
        if (draftedIds.includes(c.id)) {
          c.status = 'gathering';
          c.aiSatisfied = false;
          c.humanSatisfied = false;
        }
      }
    }
  }

  const compIds = comps.map((c) => c.id);
  const compParticipants = compIds.length > 0
    ? await dbi
        .select({ scopeId: participant.scopeId, memberId: participant.memberId, role: participant.role })
        .from(participant)
        .where(and(eq(participant.scope, 'component'), inArray(participant.scopeId, compIds)))
    : [];

  const approversByComp = new Map<string, string[]>();
  const reviewersByComp = new Map<string, string[]>();
  for (const p of compParticipants) {
    if (!p.scopeId) continue;
    const map = p.role === 'approver' ? approversByComp : reviewersByComp;
    const list = map.get(p.scopeId) ?? [];
    list.push(p.memberId);
    map.set(p.scopeId, list);
  }

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
      approvedBy: approversByComp.get(c.id) ?? [],
      mmaSessionId: c.mmaSessionId,
      participantIds: reviewersByComp.get(c.id) ?? [],
      orderIndex: c.orderIndex,
      sections: secs.map((s, i) => ({
        id: s.id,
        key: s.key,
        label: s.label,
        draftMd: i === 0
          ? fileComponentContent.get(templateForKind(c.kind as ComponentKind).label.toLowerCase()) ?? null
          : null,
        orderIndex: s.orderIndex,
      })),
    });
  }
  return views;
}

/** The repaint payload returned by the nod handler. */
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
