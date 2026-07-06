import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import type { ComponentKind } from '@/db/enums';
import { readExplorationSummaryAsync } from '@/projects/project-files';
import { updateDetails } from '@/details/write';
import { validateDetails } from '@/details/schema';
import { project } from '@/db/schema/projects';
import { teamSpecTemplate } from '@/db/schema/team';
import { projectEventBus } from '@/sse/event-bus';

/**
 * Spec orchestrator — component lifecycle helpers for the Craft + Outline phases.
 *
 * - `confirmComponents` — Outline phase: store selected component templates in details
 * - `onHumanSatisfied` — Craft phase: per-component approval (nod)
 * - `allComponentsApproved` — assemble gate
 * - `getLatestExploration` — grounding helper for prompts
 */

export interface OrchestratorDeps {
  db?: Db;
}

/* ── Grounding ────────────────────────────────────────────────────────── */

/** Read the exploration brief from file for grounding. */
export async function getLatestExploration(
  projectId: string,
): Promise<{ bodyMd: string } | null> {
  const bodyMd = await readExplorationSummaryAsync(projectId);
  return bodyMd ? { bodyMd } : null;
}

/* ── Component lifecycle ──────────────────────────────────────────────── */

/**
 * The human nod ("Looks good") — adds the member to the component's approvals.
 */
export async function onHumanSatisfied(deps: OrchestratorDeps, projectId: string, componentId: string, memberId?: string): Promise<void> {
  const db = deps.db ?? getDb();
  // MUST filter by projectId — without the WHERE this grabbed an arbitrary project,
  // so approvals silently no-oped (or hit the wrong project) whenever more than one
  // project existed.
  const [projRow] = await db.select({ id: project.id, details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!projRow?.details) return;
  const d = validateDetails(projRow.details);
  const comp = d.stages.spec.phases.craft.components.find((c) => c.id === componentId);
  if (!comp) return;

  await updateDetails(db, projRow.id, (det) => {
    const c = det.stages.spec.phases.craft.components.find((x) => x.id === componentId);
    if (c && memberId && !c.approvals.includes(memberId)) {
      c.approvals.push(memberId);
      // An approver is by definition a participant — keep the stage roster complete
      // so downstream readers (dashboard "who's involved") never miss an approver.
      if (!det.stages.spec.participants.includes(memberId)) {
        det.stages.spec.participants.push(memberId);
      }
    }
    return det;
  });

  // Notify subscribed clients so the approval reflects without a manual refresh —
  // same pattern as the revoke and invite routes (client refreshes on 'spec.updated').
  projectEventBus.publish(projectId, { type: 'spec.updated' });
}

/* ── Outline confirm: store selected templates ──────────────────────── */

/**
 * Store the selected component kinds in details with generated UUIDs. Additive:
 * already-approved components are kept; unapproved ones are replaced.
 */
export async function confirmComponents(
  db: Db,
  projectId: string,
  kinds: ComponentKind[],
): Promise<void> {
  const tplRows = await db.select({ id: teamSpecTemplate.id, kind: teamSpecTemplate.kind })
    .from(teamSpecTemplate).where(inArray(teamSpecTemplate.kind, kinds));
  const kindToId = new Map(tplRows.map((r) => [r.kind, r.id]));
  const selectedIds = kinds.map((k) => kindToId.get(k)).filter(Boolean) as string[];

  await updateDetails(db, projectId, (d) => {
    const existing = d.stages.spec.phases.craft.components;
    const approved = existing.filter((c) => c.approvals.length > 0);
    const approvedIds = new Set(approved.map((c) => c.templateId));

    const newComponents = selectedIds
      .filter((id) => !approvedIds.has(id))
      .map((templateId) => ({
        id: randomUUID(),
        templateId,
        approvals: [] as string[],
      }));

    d.stages.spec.phases.craft.components = [
      ...approved.filter((c) => selectedIds.includes(c.templateId)),
      ...newComponents,
    ];
    d.stages.spec.phases.outline.selectedTemplateIds = selectedIds;
    return d;
  });
}

/** True iff every component has at least one approval (assemble gate). */
export async function allComponentsApproved(db: Db, projectId: string): Promise<boolean> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return false;
  const d = validateDetails(row.details);
  const comps = d.stages.spec.phases.craft.components;
  return comps.length > 0 && comps.every((c) => c.approvals.length > 0);
}
